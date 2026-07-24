"""
graph_agent.py  —  Agent 4
──────────────────────────
Reads all wiki_pages from Supabase and keeps the knowledge graph
(nodes + edges tables) fully up to date.

Node types
──────────
  episode   one per wiki_page              label = page title
  concept   one per unique concept         label = concept title
  resource  one per unique entity          label = drug / protein / target / tool name

Edges
─────
  episode  → concept   relationship = "has_concept"
  concept  → concept   relationship = "shared_concept"   (co-occur in same episode)
  concept  → resource  relationship = "related_to"       (same wiki page)

Duplicate-safe — loads all existing nodes/edges at startup; never re-inserts.

Required Supabase column (run once in SQL editor if not already present):
  ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT '{}';

Exposes:
    run_graph_agent() -> None
"""

import os
import requests
from dotenv import load_dotenv

_ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(_ENV_PATH)

from supabase_client import sb_get, sb_post   # noqa: E402


# ── Node upsert ────────────────────────────────────────────────────────────────

def _upsert_node(
    label: str,
    node_type: str,
    description: str,
    existing: dict[str, str],
) -> tuple[str, bool]:
    """
    Ensure a node with this label exists in the DB.
    Returns (uuid, is_new).  Returns ("", False) on failure.

    Checks `existing` dict first — O(1) lookup, no extra DB round-trip.
    On 409 / 422 conflict, fetches the existing row's id so callers can
    still build edges.
    """
    label = label.strip()
    if not label:
        return "", False
    if label in existing:
        return existing[label], False

    try:
        result = sb_post("nodes", {
            "label":       label,
            "type":        node_type,
            "description": description,
        })
        if result:
            nid = result[0]["id"]
            existing[label] = nid
            return nid, True
    except requests.HTTPError as exc:
        status = exc.response.status_code
        if status in (409, 422):
            # Node already exists — recover its id so edges still work
            try:
                rows = sb_get("nodes", {"label": f"eq.{label}", "select": "id"})
                if rows:
                    nid = rows[0]["id"]
                    existing[label] = nid
                    return nid, False
            except Exception:
                pass
            print(f"      ⚠️  Node conflict, id not recovered: '{label[:50]}'")
        else:
            print(f"      ⚠️  Node insert HTTP {status}: '{label[:50]}'")
    except Exception as exc:
        print(f"      ⚠️  Node error '{label[:50]}': {exc}")

    return "", False


# ── Edge upsert ────────────────────────────────────────────────────────────────

def _upsert_edge(
    src_id: str,
    tgt_id: str,
    rel: str,
    existing: set[tuple[str, str]],
) -> bool:
    """
    Ensure an edge (src → tgt) exists.
    Returns True when a new edge was inserted.
    On 409 / 422 adds pair to `existing` to avoid future retries.
    """
    if not src_id or not tgt_id or src_id == tgt_id:
        return False
    pair = (src_id, tgt_id)
    if pair in existing:
        return False
    try:
        sb_post("edges", {
            "source_id":    src_id,
            "target_id":    tgt_id,
            "relationship": rel,
        })
        existing.add(pair)
        return True
    except requests.HTTPError as exc:
        if exc.response.status_code in (409, 422):
            existing.add(pair)   # already there — don't retry
        else:
            print(f"      ⚠️  Edge HTTP {exc.response.status_code}: "
                  f"{src_id[:8]}→{tgt_id[:8]}")
    except Exception as exc:
        print(f"      ⚠️  Edge error: {exc}")
    return False


# ── Data normalisation helpers ─────────────────────────────────────────────────

def _concept_titles(concepts) -> list[str]:
    """
    Normalise wiki_pages.concepts.
    Accepts:  text[] (plain strings)  or  jsonb list of {title, bullets}.
    """
    if not concepts:
        return []
    out = []
    for item in concepts:
        t = item.get("title") if isinstance(item, dict) else str(item)
        t = (t or "").strip()
        if t:
            out.append(t)
    return out


def _entity_labels(entities) -> list[str]:
    """
    Flatten wiki_pages.entities {drugs, proteins, targets, tools} → label list.
    Handles null, plain list, or properly structured dict.
    """
    if not entities:
        return []
    if isinstance(entities, list):
        return [str(e).strip() for e in entities if e]
    out = []
    for key in ("drugs", "proteins", "targets", "tools"):
        for item in (entities.get(key) or []):
            label = str(item).strip()
            if label:
                out.append(label)
    return out


# ── Main agent ─────────────────────────────────────────────────────────────────

def run_graph_agent() -> None:
    print()
    print("═" * 62)
    print("  🕸️   Knowledge Graph Agent  (Agent 4)")
    print("═" * 62)
    print()

    # ── Phase 1: Load wiki_pages ───────────────────────────────────────────
    print("📚 Fetching wiki_pages from Supabase…")
    try:
        pages = sb_get(
            "wiki_pages",
            {"select": "id,title,slug,episode_number,concepts,tags,entities"},
        )
    except Exception as exc:
        print(f"   ❌ Could not fetch wiki_pages: {exc}")
        return

    print(f"   ✅ {len(pages)} page(s) found.")
    if not pages:
        print("   Nothing to do.\n")
        return

    # ── Phase 2: Load existing graph state ────────────────────────────────
    print("\n📊 Loading existing nodes and edges…")
    existing_nodes: dict[str, str] = {}
    existing_edges: set[tuple[str, str]] = set()
    try:
        for n in sb_get("nodes", {"select": "id,label"}):
            existing_nodes[n["label"]] = n["id"]
        for e in sb_get("edges", {"select": "source_id,target_id"}):
            existing_edges.add((e["source_id"], e["target_id"]))
    except Exception as exc:
        print(f"   ❌ Could not load graph: {exc}")
        return
    print(f"   {len(existing_nodes)} nodes, {len(existing_edges)} edges already in DB.\n")

    # Counters
    new_ep_nodes       = 0
    new_concept_nodes  = 0
    new_resource_nodes = 0
    new_edges          = 0

    # Index structures for cross-page edges
    concept_to_ep_ids:    dict[str, list[str]] = {}   # label → [ep_id…]
    ep_to_concept_ids:    dict[str, list[str]] = {}   # ep_id → [concept_id…]
    ep_to_resource_ids:   dict[str, list[str]] = {}   # ep_id → [resource_id…]

    # ── Phase 3: Per-page node + direct edge creation ─────────────────────
    print("🔵 Processing wiki pages…\n")

    for page in pages:
        title    = (page.get("title") or "").strip()
        ep_num   = page.get("episode_number") or 0
        concepts = _concept_titles(page.get("concepts"))
        entities = _entity_labels(page.get("entities"))

        if not title:
            continue

        print(f"  📄 Episode {ep_num}: {title}")
        print(f"     {len(concepts)} concept(s)  |  {len(entities)} resource(s)")

        # ── Episode node ──────────────────────────────────────────────────
        ep_id, is_new = _upsert_node(
            title, "episode",
            f"Episode {ep_num}" if ep_num else title,
            existing_nodes,
        )
        if not ep_id:
            print(f"     ❌ Episode node failed — skipping this page\n")
            continue
        if is_new:
            new_ep_nodes += 1
            print(f"     ✔ [NEW] episode node")
        else:
            print(f"     ✔ [existing] episode node")

        ep_to_concept_ids[ep_id]  = []
        ep_to_resource_ids[ep_id] = []

        # ── Concept nodes + episode → concept edges ───────────────────────
        for c_title in concepts:
            c_id, is_new_c = _upsert_node(c_title, "concept", "", existing_nodes)
            if not c_id:
                continue
            if is_new_c:
                new_concept_nodes += 1

            if _upsert_edge(ep_id, c_id, "has_concept", existing_edges):
                new_edges += 1

            concept_to_ep_ids.setdefault(c_title, []).append(ep_id)
            ep_to_concept_ids[ep_id].append(c_id)

        # ── Resource nodes (no direct episode→resource edge per spec) ─────
        for e_label in entities:
            r_id, is_new_r = _upsert_node(
                e_label, "resource",
                f"Entity: {e_label}",
                existing_nodes,
            )
            if not r_id:
                continue
            if is_new_r:
                new_resource_nodes += 1

            ep_to_resource_ids[ep_id].append(r_id)

        print()

    # ── Phase 4: Concept → Concept edges (shared_concept) ─────────────────
    print("🔗 Building concept → concept edges…")
    c_c = 0
    c_list = list(concept_to_ep_ids.keys())
    for i, c1 in enumerate(c_list):
        c1_id = existing_nodes.get(c1, "")
        if not c1_id:
            continue
        eps1 = set(concept_to_ep_ids[c1])
        for c2 in c_list[i + 1 :]:
            c2_id = existing_nodes.get(c2, "")
            if not c2_id:
                continue
            if eps1 & set(concept_to_ep_ids[c2]):
                if _upsert_edge(c1_id, c2_id, "shared_concept", existing_edges):
                    new_edges += 1
                    c_c += 1
    print(f"   ✅ {c_c} new concept→concept edge(s)")

    # ── Phase 5: Concept → Resource edges (related_to) ────────────────────
    print("🔗 Building concept → resource edges…")
    c_r = 0
    for ep_id, c_ids in ep_to_concept_ids.items():
        r_ids = ep_to_resource_ids.get(ep_id, [])
        for c_id in c_ids:
            for r_id in r_ids:
                if _upsert_edge(c_id, r_id, "related_to", existing_edges):
                    new_edges += 1
                    c_r += 1
    print(f"   ✅ {c_r} new concept→resource edge(s)")

    # ── Summary ────────────────────────────────────────────────────────────
    print()
    print("═" * 62)
    print(f"  ✅ {new_ep_nodes} episode nodes, {new_concept_nodes} concept nodes,")
    print(f"     {new_resource_nodes} resource nodes, {new_edges} edges created")
    print(f"     Total nodes in DB : {len(existing_nodes)}")
    print(f"     Total edges in DB : {len(existing_edges)}")
    print("═" * 62)
    print()


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    run_graph_agent()
