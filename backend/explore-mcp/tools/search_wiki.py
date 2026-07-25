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


def search_wiki(query: str, limit: int = 20) -> list[Item]:
    """Search the internal wiki (podcast-derived episode pages) over title,
    description, concepts and tags. Returns up to `limit` Items (kind="episode"),
    highest episode number first. Never returns the episode transcript."""
    rows = sb_get("wiki_pages", {"select": _SELECT})   # GET only — read-only

    q = (query or "").strip().lower()
    matches = [row for row in rows if not q or q in _search_blob(row)]
    matches.sort(key=lambda r: r.get("episode_number") or 0, reverse=True)
    return [_to_item(r) for r in matches[:limit]]
