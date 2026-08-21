"""
tests/test_upstream_logging.py — sources/base.py's 429 / non-2xx WARNING logging.

Previously untested: every fake-response double elsewhere in tests/ predates
this logging (added in an earlier fix) and never implemented `status_code`,
so a since-removed `getattr(resp, "status_code", 200)` fallback made every
double silently report success — the 429 and non-2xx branches in
sources/base.py._log_non_2xx were reachable in production but never actually
exercised by a test. These tests close that gap directly against
get_json/post_json (not through a specific source fetcher), asserting the
WARNING is actually emitted, with the query string redacted.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
import pytest  # noqa: E402

from sources.base import get_json, post_json  # noqa: E402


def _client_returning(status_code: int) -> httpx.AsyncClient:
    """A real httpx.AsyncClient wired to a MockTransport — not a hand-rolled
    fake — so `status_code` behaves exactly as it does against a real
    upstream, and raise_for_status() raises for real on non-2xx."""

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={}, request=request)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_get_json_429_logs_a_warning_with_redacted_url(caplog):
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&api_key=SECRET123"
    with caplog.at_level(logging.WARNING, logger="sources.base"):
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(_fetch_get(url, 429))

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    msg = warnings[0].message
    assert "429" in msg
    assert "rate limited" in msg
    assert "eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" in msg
    # the query string — and the secret riding in it — must never appear
    assert "api_key" not in msg
    assert "SECRET123" not in msg


@pytest.mark.parametrize("status", [400, 403, 500, 503])
def test_get_json_non_2xx_logs_a_warning(caplog, status):
    url = "https://api.openalex.org/works?search=egfr&api_key=someone-secret-key"
    with caplog.at_level(logging.WARNING, logger="sources.base"):
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(_fetch_get(url, status))

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    msg = warnings[0].message
    assert f"status={status}" in msg
    assert "non-2xx" in msg
    assert "api.openalex.org/works" in msg
    assert "api_key" not in msg
    assert "someone-secret-key" not in msg


def test_get_json_200_logs_no_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="sources.base"):
        asyncio.run(_fetch_get("https://example.org/ok", 200))
    assert [r for r in caplog.records if r.levelno == logging.WARNING] == []


def test_post_json_429_logs_a_warning(caplog):
    url = "https://api.grants.gov/v1/api/search2"
    with caplog.at_level(logging.WARNING, logger="sources.base"):
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(_fetch_post(url, 429))

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "429" in warnings[0].message
    assert "rate limited" in warnings[0].message


def test_exception_message_itself_is_also_redacted():
    """Belt-and-suspenders: not just the WARNING log — the exception raised
    (and thus anything a later `logger.exception()` traceback would print)
    must not carry the query string either."""
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=SECRET456"
    try:
        asyncio.run(_fetch_get(url, 429))
        assert False, "expected HTTPStatusError"
    except httpx.HTTPStatusError as exc:
        assert "SECRET456" not in str(exc)
        assert "api_key" not in str(exc)


async def _fetch_get(url: str, status: int):
    async with _client_returning(status) as client:
        return await get_json(client, url)


async def _fetch_post(url: str, status: int):
    async with _client_returning(status) as client:
        return await post_json(client, url, {"q": "test"})
