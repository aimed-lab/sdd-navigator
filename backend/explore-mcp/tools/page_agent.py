"""
tools/page_agent.py — the PAGE agent: the same search -> wiki-note-writing ->
evidence-filing pipeline tools/project_agent.py already runs for a project,
but seeded from a bare TOPIC STRING instead of a project's
name/description/target/indication/modality/stage.

WHY A NEW FILE, NOT A CHANGE TO project_agent.py: this task is additive-only —
tools/project_agent.py and its run_project_agent_async() are left completely
untouched. This module is a thin wrapper: it builds the minimal "goal text"/
"goal summary" a bare topic can support, then calls the exact same building
blocks project_agent.py already exports (build_wiki_notes/file_evidence/
split_unfiled/suggest_missing_notes from tools/wiki_agent.py, and
explore_async from tools/explore.py) so there is exactly one implementation
of "search a goal and write wiki notes for it" in this codebase, not two.

NO CHECKLIST, NO DIGEST, NO RELEVANCE-PASS SELECTION. A page has no
target/indication/modality/stage and nothing analogous to a project's
Resources/Checklist review-and-accept UI — see CLAUDE.md's "IT PROPOSES; THE
FRONTEND PERSISTS" note, which doesn't apply here since a page's frontend
route persists directly (no human review step for a topic-seeded page). This
module skips project_agent.py's step 2 (relevance ranking for a save-review
list) and step 3 (checklist proposal) entirely — a living page only needs the
candidate pool for wiki-note-writing and evidence-filing, both of which
operate on the full candidate list, not a ranked top-8.
"""

from __future__ import annotations

import logging

from tools.explore import explore_async
from tools.wiki_agent import build_wiki_notes, file_evidence, split_unfiled, suggest_missing_notes

logger = logging.getLogger(__name__)

# Same cap tools/project_agent.py uses for its own candidate pool, so a page
# seeded from a very broad topic doesn't hand wiki_agent.py an unbounded list.
MAX_CANDIDATES = 60

# Same kind exclusion as project_agent.py's own _AGENT_EXCLUDED_KINDS — see
# that module's docstring for why "episode" specifically is dropped from an
# agent's own candidate pool (podcast-derived wiki pages, not useful as
# evidence for a note).
_AGENT_EXCLUDED_KINDS = {"episode"}


def _page_goal_text(topic: str) -> str:
    """The minimal equivalent of project_agent.py's _project_goal_text() for
    a bare topic — a page has no name/description/target/indication/modality/
    stage to combine, just the raw topic string the caller typed. explore_async
    already treats free text as "name. description"-shaped input (see that
    module's own docstring and tools/project_agent.py's step 1 note); a lone
    topic string satisfies that shape trivially (no second sentence)."""
    return (topic or "").strip()


def _page_goal_summary(topic: str) -> str:
    """The minimal equivalent of project_agent.py's _goal_summary() — one
    line describing what's being researched, used the same way there: to
    justify wiki-note picks against, and to shape the run's own summary
    text."""
    return (topic or "").strip()


def _flatten_candidates(explore_result: dict, max_candidates: int = 0) -> tuple[list[dict], list[str], int]:
    """Same round-robin-across-sections flattening as project_agent.py's own
    _flatten_candidates, minus the excluded_ids drop — a page has no
    "already saved" set to exclude candidates against (no Resources list
    exists for a page). See that function's own docstring for why round-
    robin, not a flat slice, is used here. Returns (items, failed_tool_names,
    total_found)."""
    seen: set[str] = set()
    failed: list[str] = []

    per_section: list[list[dict]] = []
    for section in explore_result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        if section.get("kind") in _AGENT_EXCLUDED_KINDS:
            continue
        if section.get("error"):
            failed.append(section.get("tool") or section.get("kind") or "unknown")
        bucket: list[dict] = []
        for item in section.get("items") or []:
            item_id = item.get("id")
            if not item_id or item_id in seen:
                continue
            seen.add(item_id)
            bucket.append(item)
        if bucket:
            per_section.append(bucket)

    items: list[dict] = []
    row = 0
    while per_section and (max_candidates <= 0 or len(items) < max_candidates):
        advanced = False
        for bucket in per_section:
            if row >= len(bucket):
                continue
            items.append(bucket[row])
            advanced = True
            if 0 < max_candidates <= len(items):
                break
        if not advanced:
            break
        row += 1

    return items, failed, len(seen)


async def run_page_agent_async(topic: str) -> dict:
    """Run the page pipeline for one bare topic string. Mirrors
    run_project_agent_async's own WIKI NOTES + EVIDENCE FILING stages
    verbatim (same wiki_agent.py functions, same "filed against notes as
    they'll look after this run's create/update proposals land, keyed by
    slug" wiring — see that function's own docstring) — this function exists
    only because a page has no project to read a goal or existing notes
    from, so there is nothing else here to change.

    `existing_notes` is always [] — a brand-new page always starts with no
    notes; there is no "page already exists, refresh it" caller yet (a page
    is created once per POST /api/pages call, see server.py's route below).

    Returns:
      {
        summary: str,
        wiki_notes: [{action, note_id, slug, title, note_type, body}],
        evidence_filings: {slug: [{item, shared_terms}]},
        unfiled_items: [item],
        project_level_items: [item],   # named for parity with the project
                                        # agent's own output shape (a
                                        # grant/trial that matched no note) —
                                        # frontend/lib/server/pages/pageEvidence.ts
                                        # treats it exactly like unfiled_items,
                                        # same as the project flow's own
                                        # persistence does
        missing_note_suggestions: [{term, count, item_ids}],
        candidates_found: int,
        tools_called: [str],
        warnings: [str],
        search_failed: bool,
      }

    Never raises for a normal upstream failure — every step degrades on its
    own, same resilience contract as run_project_agent_async."""
    warnings: list[str] = []
    goal_text = _page_goal_text(topic)
    goal_summary = _page_goal_summary(topic)

    try:
        explore_result = await explore_async(goal_text)
        search_failed = False
    except Exception:
        logger.exception("page_agent: search step failed entirely")
        explore_result = {"sections": [], "tools_called": [], "reasoning": None}
        search_failed = True

    if search_failed:
        warnings.append("The search step failed; no candidates were found.")

    candidates, failed_tools, candidates_found = _flatten_candidates(
        explore_result, max_candidates=MAX_CANDIDATES
    )
    if failed_tools:
        warnings.append(f"These sources didn't return results: {', '.join(failed_tools)}.")

    # No relevance pass, no checklist — see this module's own docstring for
    # why. `selected` is passed as [] to build_wiki_notes: that function's
    # own vocabulary pool (_found_vocab) also reads `candidates` directly, so
    # passing the full candidate pool there (not just an empty "selected"
    # list) still gives note-writing real material to ground itself in.
    wiki_notes: list[dict] = []
    dropped_notes = 0
    wiki_fallback = False
    if candidates:
        wiki_notes, wiki_fallback, dropped_notes = build_wiki_notes(
            goal_summary, candidates, [], [], []
        )
        if wiki_fallback:
            warnings.append("Couldn't write wiki notes for this topic this run.")
        if dropped_notes:
            warnings.append(
                f"Dropped {dropped_notes} proposed note(s) that weren't grounded in anything "
                "this run actually found."
            )

    notes_by_slug = {n["slug"]: {"slug": n["slug"], "title": n["title"], "body": n["body"]} for n in wiki_notes}
    evidence_filings, unfiled_all = file_evidence(candidates, list(notes_by_slug.values()))
    unfiled_items, project_level_items = split_unfiled(unfiled_all)
    missing_note_suggestions = suggest_missing_notes(unfiled_items)

    summary_bits = [f"Searched {len(explore_result.get('tools_called') or [])} sources for “{goal_summary}”."]
    if wiki_notes:
        summary_bits.append(f"Wrote {len(wiki_notes)} wiki note(s).")
    elif not candidates:
        summary_bits.append("Found nothing to write about this topic this run.")

    return {
        "summary": " ".join(summary_bits),
        "wiki_notes": wiki_notes,
        "evidence_filings": evidence_filings,
        "unfiled_items": unfiled_items,
        "project_level_items": project_level_items,
        "missing_note_suggestions": missing_note_suggestions,
        "candidates_found": candidates_found,
        "tools_called": explore_result.get("tools_called") or [],
        "warnings": warnings,
        "search_failed": search_failed,
    }
