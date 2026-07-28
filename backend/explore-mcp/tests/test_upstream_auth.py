"""
tests/test_upstream_auth.py — upstream API auth is wired, and is OPTIONAL.

For each authenticated source, asserts both directions:
  * env var set   -> the credential reaches the request
  * env var unset -> the request still goes out, unauthenticated

Also pins that the credential is read at CALL time rather than import time —
server.py imports the tools BEFORE it calls load_dotenv(), so a module-level
os.environ read would silently miss every value in .env.

No network: the fetchers are driven with a fake client that records the request.
No real keys appear anywhere here.
"""

from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from sources.github import fetch_github  # noqa: E402
from sources.openalex import fetch_openalex  # noqa: E402
from sources.pubmed import fetch_pubmed  # noqa: E402


class _Resp:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        # Real httpx.Response always has this; sources/base.py's get_json now
        # reads it directly (no getattr fallback), so an unfaithful double
        # fails loudly rather than silently reporting 200.
        self.status_code = status_code

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _SpyClient:
    """Records every (url, headers) and replays canned payloads in order."""

    def __init__(self, payloads):
        self.calls: list[tuple[str, dict]] = []
        self._payloads = list(payloads)

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs.get("headers") or {}))
        payload = self._payloads.pop(0) if self._payloads else {}
        return _Resp(payload)

    @property
    def urls(self) -> list[str]:
        return [u for u, _ in self.calls]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Every test starts from a known-empty auth environment."""
    for var in ("NCBI_API_KEY", "OPENALEX_EMAIL", "GITHUB_TOKEN"):
        monkeypatch.delenv(var, raising=False)


# ── PubMed / NCBI ─────────────────────────────────────────────────────────────

# esearch returns one id; esummary returns an empty result (we only assert URLs).
_PUBMED_PAYLOADS = [{"esearchresult": {"idlist": ["123"]}}, {"result": {}}]


def test_pubmed_sends_api_key_on_both_eutils_calls(monkeypatch):
    monkeypatch.setenv("NCBI_API_KEY", "test-ncbi-key")
    client = _SpyClient(_PUBMED_PAYLOADS)
    asyncio.run(fetch_pubmed(client, "egfr", 5))

    assert len(client.urls) == 2, "expected esearch + esummary"
    assert all("api_key=test-ncbi-key" in u for u in client.urls), client.urls
    assert "esearch.fcgi" in client.urls[0] and "esummary.fcgi" in client.urls[1]


def test_pubmed_works_without_a_key(monkeypatch):
    client = _SpyClient(_PUBMED_PAYLOADS)
    asyncio.run(fetch_pubmed(client, "egfr", 5))

    assert len(client.urls) == 2
    assert not any("api_key" in u for u in client.urls), client.urls


def test_pubmed_blank_key_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv("NCBI_API_KEY", "   ")
    client = _SpyClient(_PUBMED_PAYLOADS)
    asyncio.run(fetch_pubmed(client, "egfr", 5))
    assert not any("api_key" in u for u in client.urls)


def test_pubmed_key_is_read_at_call_time(monkeypatch):
    """Set AFTER import — mirrors load_dotenv() running after the tool imports."""
    client = _SpyClient(_PUBMED_PAYLOADS)
    monkeypatch.setenv("NCBI_API_KEY", "late-bound-key")
    asyncio.run(fetch_pubmed(client, "egfr", 5))
    assert all("api_key=late-bound-key" in u for u in client.urls)


# ── OpenAlex ──────────────────────────────────────────────────────────────────


def test_openalex_sends_mailto_polite_pool(monkeypatch):
    monkeypatch.setenv("OPENALEX_EMAIL", "researcher@uab.edu")
    client = _SpyClient([{"results": []}])
    asyncio.run(fetch_openalex(client, "egfr", 5))

    assert "mailto=researcher%40uab.edu" in client.urls[0], client.urls[0]


def test_openalex_works_without_an_email():
    client = _SpyClient([{"results": []}])
    asyncio.run(fetch_openalex(client, "egfr", 5))
    assert "mailto" not in client.urls[0]


def test_openalex_mailto_coexists_with_the_sort_param(monkeypatch):
    """The two query-string additions must not clobber each other."""
    from sources.openalex import SORT_RECENT, SORT_RELEVANCE

    monkeypatch.setenv("OPENALEX_EMAIL", "a@b.org")

    recency = _SpyClient([{"results": []}])
    asyncio.run(fetch_openalex(recency, "egfr", 5, sort=SORT_RECENT))
    assert "sort=publication_date:desc" in recency.urls[0]
    assert "mailto=a%40b.org" in recency.urls[0]

    relevance = _SpyClient([{"results": []}])
    asyncio.run(fetch_openalex(relevance, "egfr", 5, sort=SORT_RELEVANCE))
    assert "sort=" not in relevance.urls[0]
    assert "mailto=a%40b.org" in relevance.urls[0]


# ── GitHub ────────────────────────────────────────────────────────────────────


def test_github_sends_bearer_authorization(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "test-gh-token")
    client = _SpyClient([{"items": []}])
    asyncio.run(fetch_github(client, "rnaseq", 5))

    _, headers = client.calls[0]
    assert headers.get("Authorization") == "Bearer test-gh-token"
    assert headers.get("Accept") == "application/vnd.github+json"


def test_github_works_without_a_token():
    client = _SpyClient([{"items": []}])
    asyncio.run(fetch_github(client, "rnaseq", 5))

    _, headers = client.calls[0]
    assert "Authorization" not in headers
    assert headers.get("Accept") == "application/vnd.github+json"


def test_no_credential_leaks_into_a_url_for_github(monkeypatch):
    """The GitHub token must travel as a header, never in the query string."""
    monkeypatch.setenv("GITHUB_TOKEN", "test-gh-token")
    client = _SpyClient([{"items": []}])
    asyncio.run(fetch_github(client, "rnaseq", 5))
    assert "test-gh-token" not in client.urls[0]
