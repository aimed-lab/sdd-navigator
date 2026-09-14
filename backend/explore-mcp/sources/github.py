"""
sources/github.py — GitHub repository search fetcher.

Port of _reference/ts-sources/sources/github.ts. Same URL, same `stars:>=5`
filter, same field mapping, same blank-title drop (repos with no full_name).
GitHub reports a real popularity metric, so each Item carries a stars Signal.

Auth: GITHUB_TOKEN (optional) is sent as an `Authorization: Bearer` header.
Unset -> unauthenticated requests, which still work (at the lower limit). Read at
CALL time, not import time, because server.py imports the tools before
load_dotenv().

RATE LIMIT — this endpoint is /search/repositories, which draws on GitHub's
SEARCH bucket, not the core one. Measured against the live API:
    search:  10 req/MINUTE anonymous -> 30 req/MINUTE authenticated
    core:  5000 req/hour authenticated  (the widely-quoted 60 -> 5000 figure —
           it does NOT apply here)
So the ceiling that matters for search_tools is per-minute and small even when
authenticated: 30/min. Cache accordingly.
"""

from __future__ import annotations

import base64
import os
from urllib.parse import quote

import httpx

from dedupe import dedupe_key
from models import Item, Signal

from .base import filter_quality, get_json, now_iso, to_iso

# README bodies run from a few hundred bytes to (rarely) tens of KB — capped
# so a sprawling README doesn't blow past the LLM's prompt budget in
# generateArticle.ts's tool-post path, the one caller of
# fetch_github_repo_detail. Generous enough to keep the actual usage
# section, which is usually well within the first few thousand characters.
_MAX_README_CHARS = 8000


def _github_headers() -> dict[str, str]:
    """Same Accept + optional bearer-token shape fetch_github already uses
    below — pulled out so fetch_github_repo_detail doesn't duplicate it."""
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def fetch_github(client: httpx.AsyncClient, term: str, cap: int) -> list[Item]:
    headers = _github_headers()

    q = f"{term} stars:>=5"   # keep the existing minimum-stars filter
    url = (
        f"https://api.github.com/search/repositories?q={quote(q)}"
        f"&sort=stars&order=desc&per_page={cap}"
    )
    data = await get_json(client, url, headers=headers)

    items: list[Item] = []
    for r in (data or {}).get("items") or []:
        full_name = r.get("full_name")
        if not full_name:   # blank-title drop
            continue

        iso_date = to_iso(r.get("pushed_at") or "")
        html_url = r.get("html_url") or f"https://github.com/{full_name}"
        summary = r.get("description") or "Open-source tool on GitHub."

        stars = r.get("stargazers_count")
        signal = (
            Signal(metric="stars", value=float(stars), as_of=now_iso())
            if isinstance(stars, (int, float)) and not isinstance(stars, bool)
            else None
        )

        items.append(
            Item(
                id=f"github:{full_name}",
                kind="tool",
                title=full_name,
                summary=summary,
                url=html_url,
                doi=None,
                source="github",
                date_iso=iso_date,
                signal=signal,   # REAL stars metric; never fabricated
                dedupe_key=dedupe_key(html_url, full_name),
                raw=r,
            )
        )
    return filter_quality(items)


async def fetch_github_repo_detail(client: httpx.AsyncClient, owner: str, repo: str) -> dict:
    """ONE repo's metadata plus its README body — for Promote's tool-post
    generation path (tools/fetch_github_repo.py), not the search above.
    fetch_github() only ever returns what /search/repositories hands back
    (name, description, stars, pushed_at — see its own field mapping); it
    has never fetched a single repo's full record or a README at all. This
    is the first thing in this backend that does either.

    Two calls, same auth/headers as fetch_github (_github_headers), against
    the CORE API rate bucket (5000/hr authenticated), not the tight
    30/minute SEARCH bucket fetch_github draws on — a single repo lookup on
    demand doesn't need the same budgeting concern that module's own
    docstring calls out.

      GET /repos/{owner}/{repo}         -> description, language, topics,
                                            stars, pushed_at, html_url
      GET /repos/{owner}/{repo}/readme  -> base64-encoded body, decoded and
                                            capped at _MAX_README_CHARS

    The README call is isolated in its own try/except: a repo with no
    README (very possible for a small research tool) is a 404 from GitHub,
    not a reason to fail the whole detail fetch — `readme` in the result is
    simply None. The metadata call is NOT isolated the same way; if the
    repo itself doesn't exist or the metadata call fails, this raises and
    the caller (tools/fetch_github_repo.py) treats that as "not found",
    same posture fetch_github_repo_async's own docstring describes.
    """
    headers = _github_headers()

    meta = await get_json(client, f"https://api.github.com/repos/{owner}/{repo}", headers=headers)

    readme_text: str | None = None
    try:
        readme = await get_json(
            client, f"https://api.github.com/repos/{owner}/{repo}/readme", headers=headers
        )
        content = (readme or {}).get("content")
        if content:
            decoded = base64.b64decode(content).decode("utf-8", errors="replace")
            readme_text = decoded[:_MAX_README_CHARS].strip() or None
    except Exception:
        readme_text = None  # no README, private/renamed, or a transient failure — degrade, don't fail

    return {
        "full_name": meta.get("full_name") or f"{owner}/{repo}",
        "description": meta.get("description"),
        "language": meta.get("language"),
        "topics": meta.get("topics") or [],
        "stars": meta.get("stargazers_count"),
        "pushed_at": to_iso(meta.get("pushed_at") or ""),
        "html_url": meta.get("html_url") or f"https://github.com/{owner}/{repo}",
        "readme": readme_text,
    }
