"""
sources/opentargets.py — Open Targets Platform target-disease evidence fetcher.

GENE-ONLY, not a free-text search, same discipline as sources/chembl.py: the
caller supplies a gene SYMBOL, resolved to an Ensembl target id via Open
Targets' own `search` GraphQL query, and everything downstream is fetched by
that resolved id, not by keyword matching against arbitrary text.

FIRST GRAPHQL SOURCE — uses sources/base.py's `post_json`, not `get_json`.
Open Targets has no REST alternative: POST https://api.platform.opentargets.org
/api/v4/graphql, body {"query": "...", "variables": {...}}. Confirmed keyless
and free — no API key, no Authorization header sent, no 401/429 seen in any
live call made while building/verifying this fetcher (see tools/explore.py's
verification notes / the task's own live-query results). `post_json` needed
no changes: it already accepts an arbitrary JSON body and shares the same
timeout/redaction/non-2xx handling `get_json` has, so this is a template for
any future GraphQL source, not a one-off.

TWO-HOP PATTERN:
  1. `search(queryString: <gene>, entityNames: ["target"])` — resolves a gene
     SYMBOL to an Ensembl target id (e.g. "PHGDH" -> "ENSG00000092621").
     Zero-match (unknown gene, Open Targets has no target for it) returns
     None — handled by the caller as an empty result, same pattern as
     chembl.py's target-search miss.
  2. `target(ensemblId: ...)` — approvedSymbol/approvedName/biotype,
     tractability, and the target's top-N disease associations
     (`associatedDiseases(page: {index: 0, size: N})`), capped SERVER-SIDE at
     query time (not fetched-then-trimmed) — see _ASSOCIATED_DISEASES_PAGE_SIZE.

GENE-PRIMARY, DISEASE-FALLBACK: `fetch_opentargets` first tries to resolve
`query` as a gene/protein SYMBOL (Open Targets `search` with
entityNames=["target"]); if that resolves, it runs the forward
target->diseases query described below. If it does NOT resolve (the routing
trigger in tools/explore.py fires on genes OR diseases, and a disease name
like "glioblastoma" is never a valid gene search hit), it falls back to
resolving `query` as a DISEASE (entityNames=["disease"]) and runs the
REVERSE query, `disease { associatedTargets }` — Open Targets supports this
direction natively, same score + datatypeScores evidence shape, just with
`target` nested inside each row instead of `disease`. Both paths produce the
exact same Item shape (kind="target", one Item per target-disease pair), so
neither the caller (tools/search_opentargets.py) nor the frontend needs to
know which direction resolved. Neither resolving (an unknown gene AND not a
known disease) returns [] gracefully.

ONE ITEM PER TARGET-DISEASE ASSOCIATION, not one mega-item per target with
every disease nested inside. Judgment call: the user wants each card to show
"the disease, the score, and what evidence types support it" — that reads as
one card per disease association, the same granularity chembl.py already
uses (one card per mechanism/activity record, not one card per gene). A
single target->5-diseases mega-card would either cram five scores onto one
ItemCard (no room for the evidence breakdown per disease) or force the
frontend to do second-level list rendering ItemCard was never built for.
kind="target" (this task's own suggested name — a terse noun, matching
ChEMBL's "compound"; "association" was also on the table but "target" reads
better as a two-word "Target-Disease Evidence" card and pairs with
approvedSymbol/approvedName as the item's own subject).

CURATION AT FETCH TIME: the GraphQL query itself only requests approvedSymbol/
approvedName/biotype, tractability (label/modality/value), and
associatedDiseases (score, disease.id/name, datatypeScores.id/score) — there
is no larger raw target/disease object to trim from, unlike a REST source
returning a full record. `raw` per item keeps: target_ensembl_id,
target_symbol, target_name, disease_id, disease_name, score, evidence (the
datatypeScores list, renamed to {type, score} — "datatype" is Open Targets'
internal name for an evidence category like genetic_association/literature/
animal_model; "evidence" reads clearer on a card that already has "score" for
the association-level number) and tractability (see below). No off-domain/
quality filter, same reasoning as chembl.py: this is a resolved gene-target
lookup keyed by an identifier, not a free-text search susceptible to
keyword-collision junk.

TRACTABILITY: kept as a small list of {label, modality, value} where
value=true only — Open Targets returns dozens of tractability assessments per
target (one row per modality x bucket, most false), and a card has room to
show which approaches ARE viable, not an exhaustive false-flag audit. This
mirrors chembl.py's own judgment calls (e.g. dropping non-PubMed refs) about
curating to what's actually useful on a card, not preserving every upstream
field "just in case".

CAP: `cap` limits the number of Items returned, same contract as every other
source's cap. Since each target resolves to at most
_ASSOCIATED_DISEASES_PAGE_SIZE disease-association items, cap is applied by
requesting min(cap, _ASSOCIATED_DISEASES_PAGE_SIZE) from Open Targets'
own page.size — capping the query itself, not fetching more and trimming
after, same discipline the task description calls for.
"""

from __future__ import annotations

import httpx

from dedupe import dedupe_key
from models import Item

from .base import post_json

_GRAPHQL_URL = "https://api.platform.opentargets.org/api/v4/graphql"

# GraphQL query strings live as module-level constants, built once, with
# variables passed separately in the POST body (the standard GraphQL POST
# shape: {"query": <string>, "variables": {...}}) rather than f-string-
# interpolated per call — the reusable pattern for future GraphQL sources.
_SEARCH_QUERY = """
query EntitySearch($q: String!, $entityNames: [String!]) {
  search(queryString: $q, entityNames: $entityNames) {
    hits {
      id
      name
      entity
    }
  }
}
"""

_TARGET_QUERY = """
query TargetDiseases($ensemblId: String!, $pageSize: Int!) {
  target(ensemblId: $ensemblId) {
    id
    approvedSymbol
    approvedName
    biotype
    tractability {
      label
      modality
      value
    }
    associatedDiseases(page: {index: 0, size: $pageSize}) {
      count
      rows {
        score
        disease {
          id
          name
        }
        datatypeScores {
          id
          score
        }
      }
    }
  }
}
"""

# REVERSE direction — disease -> its top-N associated targets. Same score +
# datatypeScores evidence shape as the forward query, `target` nested per row
# instead of `disease`. Used only when `query` doesn't resolve as a gene (see
# module docstring's GENE-PRIMARY, DISEASE-FALLBACK section).
_DISEASE_QUERY = """
query DiseaseTargets($efoId: String!, $pageSize: Int!) {
  disease(efoId: $efoId) {
    id
    name
    associatedTargets(page: {index: 0, size: $pageSize}) {
      count
      rows {
        score
        target {
          id
          approvedSymbol
          approvedName
        }
        datatypeScores {
          id
          score
        }
      }
    }
  }
}
"""

# Cap Open Targets' OWN page.size — this is the actual cap enforced at query
# time, not a client-side trim. PHGDH alone has 895+ disease associations
# (confirmed live in the prior diagnosis round); this keeps the response to a
# small, ranked (by Open Targets' own score-descending order) top-N.
_ASSOCIATED_DISEASES_PAGE_SIZE_DEFAULT = 5


async def _post_graphql(client: httpx.AsyncClient, query: str, variables: dict) -> dict:
    """Shared GraphQL POST body shape — {"query": ..., "variables": ...} — for
    reuse by any future Open Targets (or other GraphQL) query in this module."""
    data = await post_json(client, _GRAPHQL_URL, {"query": query, "variables": variables})
    return (data or {}).get("data") or {}


async def _resolve_entity(client: httpx.AsyncClient, term: str, entity: str) -> str | None:
    """`term` -> Open Targets id for the given `entity` ("target" or
    "disease") via Open Targets' own `search` query. Zero-match returns None
    — handled by the caller as an empty result / a fallback to try, same
    pattern as chembl.py's target-search-miss handling."""
    data = await _post_graphql(client, _SEARCH_QUERY, {"q": term, "entityNames": [entity]})
    hits = ((data.get("search") or {}).get("hits")) or []
    for hit in hits:
        if hit.get("entity") == entity and hit.get("id"):
            return hit["id"]
    return None


def _curated_tractability(rows: list[dict]) -> list[dict]:
    """Keep only {label, modality, value} rows where value is True — the
    viable-approach assessments, not an exhaustive true/false audit of every
    modality Open Targets checked. See module docstring."""
    out = []
    for row in rows or []:
        if row.get("value") is True:
            out.append({
                "label": row.get("label"),
                "modality": row.get("modality"),
                "value": True,
            })
    return out


def _curated_evidence(datatype_scores: list[dict]) -> list[dict]:
    """datatypeScores (Open Targets' evidence-type breakdown — e.g.
    genetic_association, literature, animal_model, known_drug) renamed to
    {type, score} for a clearer card label than the upstream "datatype" term."""
    return [
        {"type": d.get("id"), "score": d.get("score")}
        for d in (datatype_scores or [])
        if d.get("id") is not None
    ]


def _disease_url(disease_id: str) -> str:
    return f"https://platform.opentargets.org/disease/{disease_id}"


def _make_item(
    *, ensembl_id: str, symbol: str, name: str | None, disease_id: str, disease_name: str,
    score, evidence: list[dict], tractability: list[dict], index: int,
) -> Item:
    title = f"{symbol} — {disease_name}"
    summary = (
        f"Target-disease association score {score:.3f}" if isinstance(score, (int, float))
        else "Target-disease association"
    )
    url_out = _disease_url(disease_id) if disease_id else None
    return Item(
        id=f"opentargets:{ensembl_id}:{disease_id or index}",
        kind="target",
        title=title,
        summary=summary,
        url=url_out,
        doi=None,
        source="opentargets",
        date_iso=None,
        signal=None,  # no ranking metric — association score is not a citation/star count
        dedupe_key=dedupe_key(url_out or title, title),
        raw={
            "target_ensembl_id": ensembl_id,
            "target_symbol": symbol,
            "target_name": name,
            "disease_id": disease_id,
            "disease_name": disease_name,
            "score": score,
            "evidence": evidence,
            "tractability": tractability,
        },
    )


async def _fetch_by_gene(client: httpx.AsyncClient, ensembl_id: str, cap: int) -> list[Item]:
    """FORWARD path: target -> its top-N disease associations, plus the
    target's own tractability (available directly on the `target` query)."""
    page_size = max(1, min(cap, _ASSOCIATED_DISEASES_PAGE_SIZE_DEFAULT))
    data = await _post_graphql(client, _TARGET_QUERY, {"ensemblId": ensembl_id, "pageSize": page_size})
    target = data.get("target")
    if not target:
        return []

    symbol = target.get("approvedSymbol") or ensembl_id
    name = target.get("approvedName") or None
    tractability = _curated_tractability(target.get("tractability") or [])
    rows = ((target.get("associatedDiseases") or {}).get("rows")) or []

    items: list[Item] = []
    for i, row in enumerate(rows[:cap]):
        disease = row.get("disease") or {}
        items.append(_make_item(
            ensembl_id=ensembl_id, symbol=symbol, name=name,
            disease_id=disease.get("id") or "", disease_name=disease.get("name") or "Unknown disease",
            score=row.get("score"), evidence=_curated_evidence(row.get("datatypeScores") or []),
            tractability=tractability, index=i,
        ))
    return items


async def _fetch_by_disease(client: httpx.AsyncClient, efo_id: str, cap: int) -> list[Item]:
    """REVERSE path: disease -> its top-N associated targets. Open Targets'
    `disease` query has no `tractability` field of its own (that lives only
    on `target`), and fetching it per-row here would mean one extra call per
    associated target — not worth it for a fallback path; tractability is
    simply empty for items produced this way, same "field genuinely not
    available, never fabricated" discipline as chembl.py's pref_name
    fallback."""
    page_size = max(1, min(cap, _ASSOCIATED_DISEASES_PAGE_SIZE_DEFAULT))
    data = await _post_graphql(client, _DISEASE_QUERY, {"efoId": efo_id, "pageSize": page_size})
    disease = data.get("disease")
    if not disease:
        return []

    disease_name = disease.get("name") or "Unknown disease"
    rows = ((disease.get("associatedTargets") or {}).get("rows")) or []

    items: list[Item] = []
    for i, row in enumerate(rows[:cap]):
        target = row.get("target") or {}
        ensembl_id = target.get("id") or ""
        symbol = target.get("approvedSymbol") or ensembl_id or "Unknown target"
        items.append(_make_item(
            ensembl_id=ensembl_id, symbol=symbol, name=target.get("approvedName") or None,
            disease_id=efo_id, disease_name=disease_name,
            score=row.get("score"), evidence=_curated_evidence(row.get("datatypeScores") or []),
            tractability=[], index=i,
        ))
    return items


async def fetch_opentargets(client: httpx.AsyncClient, query: str, cap: int) -> list[Item]:
    """Resolve `query` to an Open Targets target-disease evidence set — see
    module docstring's GENE-PRIMARY, DISEASE-FALLBACK section for the two-
    path resolution. Returns up to `cap` Items (kind="target",
    source="opentargets"), ONE PER target-disease association. Empty `query`,
    or a term that resolves as neither a gene nor a disease, returns []
    gracefully, same as chembl.py's empty-result handling."""
    query = (query or "").strip()
    if not query:
        return []

    ensembl_id = await _resolve_entity(client, query, "target")
    if ensembl_id:
        return await _fetch_by_gene(client, ensembl_id, cap)

    efo_id = await _resolve_entity(client, query, "disease")
    if efo_id:
        return await _fetch_by_disease(client, efo_id, cap)

    return []
