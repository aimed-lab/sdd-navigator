"""
tools/search_lab_resources.py — search the internal lab_resources registry.

Read-only lookup over the Supabase `lab_resources` table (via supabase_client.py,
GET only). One generic table spans nine categories; each category keeps its
searchable data under different keys inside the `fields` jsonb, so the
CATEGORY_FIELDS map below is the single source of truth for what to search per
category.

SECURITY: `contact_info` is auth-gated and OUT OF SCOPE here. It is never
selected from the DB and never placed in an Item (not in title/summary, not in
raw). Only the auth-gated /contact route in the web app may return it.

Every result is kind="resource", source="internal", signal=None — there is no
ranking metric for internal resources, so a signal is never attached. The live
table holds only a couple of rows; returning few or zero results is correct.
"""

from __future__ import annotations

from supabase_client import sb_get

from models import Item

# The nine categories and the `fields` jsonb keys that are searchable for each.
# The FIRST key in each list is treated as the resource's display name (title).
CATEGORY_FIELDS: dict[str, list[str]] = {
    "person":           ["name", "role", "lab"],
    "technique":        ["name", "pi_lab"],
    "equipment":        ["name", "use", "location"],
    "vector":           ["backbone", "insert", "pi"],
    "animal_model":     ["model_name", "genetic_alteration", "pi"],
    "cell_line":        ["name", "type", "pi"],
    "protein_antibody": ["name", "pi"],
    "software":         ["name", "utility", "pi"],
    "drug":             ["name", "target", "pi"],
}

# Columns pulled from the table. `contact_info` is deliberately absent — it is
# never fetched, so it can never leak into a result.
_SELECT = "id,category,fields,created_at"


def _searchable_values(category: str, fields: dict) -> list[str]:
    """The string values a free-text query is matched against for this row."""
    keys = CATEGORY_FIELDS.get(category)
    if keys is None:
        # Unknown category (not one of the nine) — fall back to every scalar
        # field value so the row is still searchable rather than silently dropped.
        return [str(v) for v in fields.values() if isinstance(v, (str, int, float))]
    return [str(fields[k]) for k in keys if fields.get(k) not in (None, "")]


def _title(category: str, fields: dict) -> str:
    """Display name: the first present searchable key, else any string field,
    else the category label."""
    for k in CATEGORY_FIELDS.get(category, []):
        if fields.get(k):
            return str(fields[k])
    for v in fields.values():
        if isinstance(v, str) and v.strip():
            return v
    return category or "resource"


def _to_item(row: dict) -> Item:
    fields = row.get("fields") or {}
    category = row.get("category") or ""
    title = _title(category, fields)

    # Summary = the remaining searchable descriptor fields (title excluded).
    descriptors = [
        f"{k}: {fields[k]}"
        for k in CATEGORY_FIELDS.get(category, [])
        if fields.get(k) not in (None, "") and str(fields[k]) != title
    ]
    summary = "; ".join(descriptors) if descriptors else (category or None)

    return Item(
        id=f"internal:{row['id']}",
        kind="resource",
        title=title,
        summary=summary,
        url=None,                         # internal resources have no public URL
        source="internal",
        date_iso=row.get("created_at"),
        signal=None,                      # no ranking metric for internal resources
        dedupe_key=f"internal:{row['id']}",  # row id is already unique
        # raw carries ONLY non-sensitive columns — contact_info is never here.
        raw={"category": category, "fields": fields, "created_at": row.get("created_at")},
    )


def search_lab_resources(
    query: str, category: str | None = None, limit: int = 20
) -> list[Item]:
    """Search the internal lab_resources registry.

    Matches `query` (case-insensitive substring) against the searchable jsonb keys
    for each row's category. When `category` is None, all nine categories are
    searched; otherwise the search is scoped to that category. Returns up to
    `limit` Items (kind="resource", source="internal"), newest first. Never
    returns contact_info.
    """
    params = {"select": _SELECT}
    if category:
        params["category"] = f"eq.{category}"

    rows = sb_get("lab_resources", params)  # GET only — read-only

    q = (query or "").strip().lower()
    matches: list[Item] = []
    for row in rows:
        cat = row.get("category") or ""
        if category and cat != category:        # defensive: don't rely solely on the server filter
            continue
        if q:
            values = _searchable_values(cat, row.get("fields") or {})
            if not any(q in v.lower() for v in values):
                continue
        matches.append(_to_item(row))

    matches.sort(key=lambda it: it.date_iso or "", reverse=True)
    return matches[:limit]
