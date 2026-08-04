"""
sources/pager.py — PAGER (Pathway, Annotated-list and Gene-signature
Electronic Repository) keyword search fetcher.

Prof. Chen's tool at discovery.informatics.uab.edu/pager-v4. Uses the
KEYWORD search endpoint found by reading the site's own JS (NOT the
documented "API" — that's a separate gene-list ENRICHMENT endpoint with
demo R/Python scripts that turned out to be dead links; this endpoint is
what the homepage search box itself calls, confirmed live 2026-08-04):

    POST https://discovery.informatics.uab.edu/pager-v4/index.php/search/search_term
    body: term_query=<text>&fuzzy=pattern&csrf_test_name=<token>

It takes free text directly (a gene symbol, a disease name, any keyword) —
the SAME query string every other source in this package already gets, no
gene-list assembly required.

── SESSION / CSRF ───────────────────────────────────────────────────────
CodeIgniter issues a `csrf_cookie_name` cookie on any GET and expects the
same value echoed back as `csrf_test_name` on POST. Confirmed live: this
endpoint currently accepts a POST with NO cookie and a garbage CSRF value
at all (HTTP 200, real results) — the check does not appear enforced on
this route today. That is not something to build on: it could start being
enforced with no notice, so `_PagerSession` still does the real warm-GET
-> read-cookie -> POST flow a well-behaved client would, and retries ONCE
on any failure by re-warming (covers both "CSRF started being enforced"
and "the session simply expired mid-request"). No retry loop beyond that
one attempt — a second failure propagates, and the caller (tools/
search_pager.py) isolates it same as every other source's failure.

── TLS ──────────────────────────────────────────────────────────────────
discovery.informatics.uab.edu's TLS handshake sends ONLY its leaf
certificate — confirmed with `openssl s_client -showcerts`, which shows
exactly one certificate in the chain. The issuer, "InCommon RSA Server CA
2", is never sent. This is a standard server misconfiguration (the host's
web server is missing an SSLCertificateChainFile/equivalent), not a
malicious or self-signed cert: the intermediate is a real, valid,
publicly-issued cert (downloaded from its own AIA caIssuers URL,
http://crt.sectigo.com/InCommonRSAServerCA2.crt), and the ROOT it chains
to ("USERTrust RSA Certification Authority") is ALREADY in certifi's
default bundle — `openssl verify -untrusted <that one cert> <leaf>` returns
OK. The gap is exactly one certificate.

>>> REPORT TO UAB IT: discovery.informatics.uab.edu is not serving the
>>> intermediate certificate "InCommon RSA Server CA 2" in its TLS
>>> handshake. Fix: configure the web server (Apache SSLCertificateChain-
>>> File / nginx ssl_certificate full-chain file) to serve the leaf +
>>> that intermediate. Downloadable at:
>>> http://crt.sectigo.com/InCommonRSAServerCA2.crt

Until that's fixed server-side, `_trust_bundle_path()` below builds a CA
bundle = certifi's stock bundle + this ONE intermediate, and ONLY the
httpx.AsyncClient this module's caller builds for PAGER uses it (see
tools/search_pager.py — `verify=_trust_bundle_path()`, never a bare
`verify=False`, and never applied to any other source's client). This is
a scoped, temporary workaround for one host's server misconfiguration —
remove it the day UAB IT fixes the chain, not a general "PAGER's CA is
untrustworthy" statement.

── RANKING ───────────────────────────────────────────────────────────────
PAGER returns results completely unsorted by quality — a BRCA1 query
returns 1,781 unsorted matches in 1.35 MB. `fetch_pager` fetches the FULL
unsorted set, ranks ALL of it by nCoCo (COCO_V2) descending, then PAG size
descending, and ONLY THEN slices to `cap`. Cutting before ranking would
silently keep whichever 20 records the university's Oracle query happened
to emit first — no relationship to quality — and throw away the actual
best matches. Same principle as WINNER: fetch wide, rank, then cut.
Because the cut happens inside this function, the caller's cache
(tools/search_pager.py) only ever stores the trimmed set — the 1.35 MB
response body never reaches the cache or the MCP response.

── TYPE CODES ────────────────────────────────────────────────────────────
PAGER's TYPE field: P = Pathway, A = Annotated list, G = Gene signature —
all three are real PAGs and are kept. A 4th code, N, appears when the
search term IS ITSELF a gene symbol (confirmed live: querying "PHGDH"
returns a TYPE=N row for GS_ID NAX001666, SOURCE="Genome Data",
DESCRIPTION=null, GS_SIZE=1 — a database stub recording that the gene
exists, not a curated gene set). N rows are DROPPED here: this tool exists
to return gene sets and pathways, and a size-1 "this gene exists" stub is
neither — surfacing it as a search result would misrepresent a raw gene
lookup as a curated PAG, and it would appear on almost every gene-symbol
query, drowning out the real pathway/gene-signature hits it happens to
share a bucket with.

── WHAT'S DELIBERATELY NOT DONE ──────────────────────────────────────────
Gene members are NOT fetched here. `genesinPAG/viewgenes/<GS_ID>` is a
SEPARATE per-PAG call — for N results that's N extra round-trips to an
already-slow university server, on the hot path of a user's search. If a
future PAG-detail view needs gene members, call
`genesinPAG/viewgenes/<GS_ID>` THERE, lazily, one PAG at a time — not here.
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import certifi
import httpx

from dedupe import dedupe_key
from models import Item

from .base import _log_non_2xx, _raise_for_status_redacted, filter_quality

logger = logging.getLogger(__name__)

_BASE = "https://discovery.informatics.uab.edu/pager-v4/"
_HOME_URL = _BASE
_SEARCH_URL = _BASE + "index.php/search/search_term"

# Tighter than sources/base.py's shared FETCH_TIMEOUT (8s). This is a
# university-run PHP/Oracle stack, not a hardened public API — one of its
# OWN internal endpoints (geoset/api/<id>) was observed returning "Legacy
# pagref service unavailable" during the investigation. Measured search_term
# timings across 7 live calls ranged 0.6-1.4s (glioblastoma 0.86s, BRCA1's
# 1.35 MB response 1.34s, empty-result queries 0.6-0.76s). 3.0s gives ~2x
# headroom over the slowest observed successful call, while still failing
# fast enough that one flaky source among nine never makes a user wait
# anywhere near the shared 8s ceiling for it.
_TIMEOUT = 3.0

_TYPE_LABELS = {"P": "Pathway", "A": "Annotated list", "G": "Gene signature"}
# "N" intentionally has no label — those rows are dropped, see module docstring.

_PAG_VIEW_URL = _BASE + "index.php/geneset/view/{gs_id}"

# ── TEMPORARY TLS WORKAROUND — see module docstring "TLS" section. ────────
# The ONE intermediate cert discovery.informatics.uab.edu fails to serve.
# Downloaded from the leaf cert's own AIA caIssuers URL
# (http://crt.sectigo.com/InCommonRSAServerCA2.crt) on 2026-08-04.
_MISSING_INTERMEDIATE_PEM = """-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----
"""


def _trust_bundle_path() -> str:
    """Build (once per process, idempotent) a CA bundle = certifi's default
    bundle + the one missing intermediate. Returns a filesystem path suitable
    for httpx's `verify=`. See module docstring "TLS" section — this is a
    scoped, temporary, host-specific workaround, not a global relaxation."""
    bundle_path = os.path.join(tempfile.gettempdir(), "pager_trust_bundle.pem")
    combined = Path(certifi.where()).read_bytes() + b"\n" + _MISSING_INTERMEDIATE_PEM.encode()
    Path(bundle_path).write_bytes(combined)
    return bundle_path


class _PagerSession:
    """GET the homepage for the CSRF cookie, then POST search_term with it.
    On any failure, re-warm and retry ONCE — no retry loop (see module
    docstring "SESSION / CSRF" section)."""

    def __init__(self, client: httpx.AsyncClient):
        self._client = client
        self._csrf: str | None = None

    async def _warm(self) -> None:
        resp = await self._client.get(_HOME_URL, timeout=_TIMEOUT)
        _log_non_2xx(resp, _HOME_URL)
        _raise_for_status_redacted(resp, _HOME_URL)
        csrf = self._client.cookies.get("csrf_cookie_name")
        if not csrf:
            raise RuntimeError("PAGER: no csrf_cookie_name cookie after warm-up")
        self._csrf = csrf

    async def _post_search(self, term: str) -> dict:
        data = {"term_query": term, "fuzzy": "pattern", "csrf_test_name": self._csrf or ""}
        resp = await self._client.post(_SEARCH_URL, data=data, timeout=_TIMEOUT)
        _log_non_2xx(resp, _SEARCH_URL)
        _raise_for_status_redacted(resp, _SEARCH_URL)
        return resp.json()

    async def search_term(self, term: str) -> dict:
        if self._csrf is None:
            await self._warm()
        try:
            return await self._post_search(term)
        except Exception:
            # ONE retry, after a fresh warm-up. Covers a stale/expired
            # session as well as a first-time enforcement of the CSRF check
            # this endpoint doesn't currently seem to apply. Not a loop: a
            # second failure here propagates to the caller.
            await self._warm()
            return await self._post_search(term)


def _parse_record_date(raw: str | None) -> str | None:
    """PAGER's RECORD_DATE is 'DD-Mon-YY' (e.g. '13-Aug-20'), not a format
    sources/base.py's to_iso() handles (that's ISO / bare-year / PubMed's
    'YYYY Mon [DD]'). strptime's %y applies the standard POSIX pivot
    (00-68 -> 2000-2068), which is correct for PAGER's data (curation
    started well after 2000). Returns None (not the epoch) on failure so
    the caller can fall back to now_iso() instead of silently mis-sorting
    to 1970 — recency isn't the sort key here (nCoCo/size is), but a
    bogus date is still worse than an honest "unknown"."""
    if not raw:
        return None
    try:
        d = datetime.strptime(raw.strip(), "%d-%b-%y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return d.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _to_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _pag_url(gs_id: str) -> str:
    return _PAG_VIEW_URL.format(gs_id=gs_id)


async def fetch_pager(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    """Fetch the FULL unsorted PAGER result set for `term`, rank ALL of it by
    nCoCo desc then size desc, and only then return the top `cap` — see
    module docstring "RANKING" section. The cap is applied HERE, inside this
    function, specifically so a caller's cache never sees the untrimmed set."""
    if not term.strip():
        return []

    session = _PagerSession(client)
    data = await session.search_term(term)

    # Three PAG buckets carry actual gene sets: name/gene-symbol/description
    # matches. `gene_by_symbol` / `gene_by_desc` are individual GENE records
    # (GENE_SYM/ENTREZ_ID, no GS_ID at all) — not PAGs, out of scope for a
    # tool whose job is gene sets and pathways.
    merged: dict[str, dict] = {}
    for bucket in ("gs_by_name", "gs_by_sym", "gs_by_desc"):
        for rec in data.get(bucket) or []:
            gs_id = rec.get("GS_ID")
            if not gs_id or gs_id in merged:
                continue
            merged[gs_id] = rec

    items: list[Item] = []
    for gs_id, rec in merged.items():
        type_code = (rec.get("TYPE") or "").strip()
        type_label = _TYPE_LABELS.get(type_code)
        if type_label is None:
            # Covers "N" (search term is itself a gene symbol — see module
            # docstring "TYPE CODES") and any unrecognized future code alike:
            # if it's not a real P/A/G PAG, it doesn't belong in this list.
            continue

        name = rec.get("NAME") or ""
        if not name.strip():
            continue

        source = rec.get("SOURCE") or None
        size = _to_int(rec.get("GS_SIZE"))
        ncoco = _to_float(rec.get("COCO_V2"))
        description = rec.get("DESCRIPTION") or None
        summary = description or f"{type_label} gene set from {source or 'PAGER'} ({size} genes)."
        url = _pag_url(gs_id)
        date_iso = _parse_record_date(rec.get("RECORD_DATE"))

        items.append(
            Item(
                id=f"pager:{gs_id}",
                kind="geneset",
                title=name,
                summary=summary,
                url=url,
                doi=None,
                source="pager",
                date_iso=date_iso,
                signal=None,  # no WINNER — gene sets have no citation graph (req. 9)
                dedupe_key=dedupe_key(url, name),
                raw={
                    "gs_id": gs_id,
                    "type_code": type_code,
                    "type_label": type_label,
                    "source": source,
                    "size": size,
                    "ncoco_score": ncoco,
                    # Gene members are NOT fetched here — see module docstring
                    # "WHAT'S DELIBERATELY NOT DONE". A future PAG-detail view
                    # would call:
                    #   GET {_BASE}index.php/genesinPAG/viewgenes/{gs_id}
                    # lazily, one PAG at a time, never eagerly for a result list.
                },
            )
        )

    quality_filtered = filter_quality(items)

    # RANK THE FULL SET, THEN CUT — never the other way around (see module
    # docstring "RANKING" section). Sorting is stable, so within equal
    # (ncoco, size) PAGER's own bucket order is preserved as the final
    # tie-break.
    quality_filtered.sort(
        key=lambda it: (it.raw["ncoco_score"], it.raw["size"]), reverse=True
    )
    return quality_filtered[:cap]
