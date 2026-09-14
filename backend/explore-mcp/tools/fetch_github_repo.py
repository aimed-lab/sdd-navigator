"""
tools/fetch_github_repo.py — single-repo detail fetch for Promote's
GitHub-generation path (frontend's /api/promote/generate, tool branch).

Wraps sources.github.fetch_github_repo_detail the same way search_tools.py
wraps fetch_github: one function, its own short-lived httpx.AsyncClient,
failures isolated to a None return rather than raised. UNLIKE search_tools.py
this is deliberately NOT cached here — /api/promote/generate (the frontend
route that calls this, via the HTTP bridge in server.py) already caches the
whole generated result keyed on the normalized input, so a second cache layer
here would only add staleness (a repo's README/description changing) with no
benefit anything actually reads.
"""

from __future__ import annotations

import logging

import httpx

from sources.github import fetch_github_repo_detail

logger = logging.getLogger(__name__)

_USER_AGENT = "explore-mcp/0.1 (SDD Navigator; research tooling)"


async def fetch_github_repo_async(owner: str, repo: str) -> dict | None:
    """None on any failure (repo doesn't exist, rate limited, network) — the
    HTTP bridge route (server.py's /api/github-repo) turns that into a clean
    404 rather than a 500, same per-source isolation posture as search_tools's
    own _fetch()."""
    try:
        async with httpx.AsyncClient(headers={"User-Agent": _USER_AGENT}) as client:
            return await fetch_github_repo_detail(client, owner, repo)
    except Exception:
        logger.exception("fetch_github_repo_async failed: owner=%r repo=%r", owner, repo)
        return None
