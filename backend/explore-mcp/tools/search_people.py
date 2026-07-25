"""
tools/search_people.py — find people, from TWO sources merged.

  1. users table (public profiles only): registered researchers. kind="person",
     source="platform". url = /researchers/<profile_slug>.
  2. lab_resources category='person': collaborators listed in the internal
     registry, via search_lab_resources logic. source="internal".

A platform user and a spreadsheet person are DISTINCT entries — the two lists are
concatenated, never deduped against each other.

SECURITY: the users query NEVER selects or returns `email`; only public profile
fields are exposed (is_public=true rows only).
"""

from __future__ import annotations

from supabase_client import sb_get

from models import Item
from tools.search_lab_resources import search_lab_resources

# Public profile columns only — `email` is deliberately absent.
_USER_SELECT = "id,name,title,affiliation,research_focus,profile_slug,orcid_url"
# Fields a free-text query is matched against for a platform user.
_USER_SEARCH_FIELDS = ("name", "title", "affiliation", "research_focus")


def _user_search_blob(row: dict) -> str:
    return " ".join(str(row.get(f) or "") for f in _USER_SEARCH_FIELDS).lower()


def _user_to_item(row: dict) -> Item:
    slug = row.get("profile_slug") or ""
    bits = [row.get("title"), row.get("affiliation"), row.get("research_focus")]
    summary = "; ".join(b for b in bits if b) or None
    return Item(
        id=f"platform:{row['id']}",
        kind="person",
        title=row.get("name") or "Researcher",
        summary=summary,
        url=f"/researchers/{slug}" if slug else None,
        doi=None,
        source="platform",
        date_iso=None,
        signal=None,
        dedupe_key=f"platform:{row['id']}",
        # raw carries public columns only; email is never selected, and is stripped
        # defensively here even if a row ever carried it.
        raw={k: v for k, v in row.items() if k != "email"},
    )


def _platform_people(query: str, limit: int) -> list[Item]:
    # is_public=true ONLY — never expose private profiles.
    rows = sb_get("users", {"select": _USER_SELECT, "is_public": "eq.true"})
    q = (query or "").strip().lower()
    matches = [r for r in rows if not q or q in _user_search_blob(r)]
    return [_user_to_item(r) for r in matches[:limit]]


def search_people(query: str, limit: int = 20) -> list[Item]:
    """Find people relevant to `query` from two sources: public platform
    researcher profiles (source="platform") and internal-registry collaborators
    (source="internal"). Returns up to `limit` Items (kind="person"). The two
    kinds of person are distinct and are not deduped. Never returns email."""
    platform = _platform_people(query, limit)

    # Reuse search_lab_resources for the 'person' category, then re-tag as people.
    registry = [
        item.model_copy(update={"kind": "person"})
        for item in search_lab_resources(query, category="person", limit=limit)
    ]

    return (platform + registry)[:limit]
