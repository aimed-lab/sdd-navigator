"""
tools/search_wiki.py — search the internal podcast-derived wiki pages.

Reads the wiki_pages table (the 64 episode pages) via supabase_client (GET only,
read-only). Free-text search runs over title, description, concepts, and tags.
kind="episode", source="internal", signal=None.

SECURITY / size: `transcript` is never selected and never returned — it is far
too large for a result item.
"""

from __future__ import annotations

import json

from supabase_client import sb_get

from models import Item

# Columns fetched. `transcript` is deliberately absent — never selected, so it
# can never appear in a result.
_SELECT = "id,slug,title,episode_number,description,summary,concepts,tags,episode_url,image_url"


def _search_blob(row: dict) -> str:
    """The text a query is matched against: title, description, concept titles/
    bullets, and tags."""
    parts: list[str] = [row.get("title") or "", row.get("description") or ""]
    for concept in row.get("concepts") or []:
        if isinstance(concept, dict):
            parts.append(str(concept.get("title") or ""))
            parts.extend(str(b) for b in (concept.get("bullets") or []))
    parts.extend(str(t) for t in (row.get("tags") or []))
    return " ".join(parts).lower()


def _to_item(row: dict) -> Item:
    slug = row.get("slug") or ""
    url = row.get("episode_url") or (f"/topics/{slug}" if slug else None)
    return Item(
        id=f"internal:{row['id']}",
        kind="episode",
        title=row.get("title") or "Untitled episode",
        summary=row.get("description"),
        url=url,
        doi=None,
        source="internal",
        date_iso=None,          # wiki_pages.created_at is not part of the result shape
        signal=None,            # no ranking metric
        dedupe_key=f"internal:{row['id']}",
        # raw carries the selected columns only; transcript is never selected, and
        # is stripped defensively here even if a row ever carried it.
        raw={k: v for k, v in row.items() if k != "transcript"},
    )


# Common words dropped from the query so "AI in drug discovery" doesn't match
# every episode on the token "in".
_STOPWORDS = {"in", "of", "the", "a", "and", "for"}


def _tokenize(query: str) -> list[str]:
    """Lowercase, split on whitespace, drop stopwords and empties."""
    return [t for t in (query or "").lower().split() if t and t not in _STOPWORDS]


def search_wiki(query: str, limit: int = 20) -> list[Item]:
    """Search the internal wiki (podcast-derived episode pages) over title,
    description, concepts and tags. Tokenizes the query on whitespace (dropping
    stopwords) and matches an episode if ANY token appears in its searchable blob;
    results are ranked by number of tokens matched (desc), then newest episode
    first. Returns up to `limit` Items (kind="episode"). Never returns the
    transcript."""
    rows = sb_get("wiki_pages", {"select": _SELECT})   # GET only — read-only

    tokens = _tokenize(query)
    if not tokens:
        # Empty / stopword-only query -> list all, newest episode first.
        matches = sorted(rows, key=lambda r: r.get("episode_number") or 0, reverse=True)
        return [_to_item(r) for r in matches[:limit]]

    scored: list[tuple[int, int, dict]] = []
    for row in rows:
        blob = _search_blob(row)
        hits = sum(1 for t in tokens if t in blob)
        if hits:
            scored.append((hits, row.get("episode_number") or 0, row))

    # rank by tokens-matched desc, then newest episode desc
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [_to_item(row) for _, _, row in scored[:limit]]
