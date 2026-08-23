"""
tools/wiki_agent.py — proposes the project wiki's notes from the SAME search
step project_agent.py already ran (candidates + the relevance pass's
`selected` items + the checklist proposal), one more branch off that one
search, same shape as the digest (tools/prior_art_brief.py) and the
checklist proposal (project_agent.py's own step 3).

WRITES NOTHING, same rule as project_agent.py itself: this module returns a
list of note proposals; frontend/lib/server/wikiNotes.ts is what actually
touches Supabase, from app/api/project-agent/status/route.ts, exactly the
digest's persistence path. "Writes directly, no approval step" (Chen's
spec) describes THAT save happening automatically, the moment a run comes
back — never a client-reachable action a human clicks through — not this
module skipping review of its own output. This module's own JSON->note
parse is reviewed just as hard as the checklist's, see the grounding gate
below.

A NOTE IS A CONCEPT OR ENTITY, NEVER A CITATION. The prompt below spells
this out because it is the one rule most likely to erode under a vague
"write what you learned" instruction — the failure mode is the model
turning a paper it read into a note titled after that paper. See this
project's own migration file (database/migrations/2026-08-22_wiki_notes.sql)
for the fuller rationale.

THREE RULES ENFORCED IN CODE, NOT JUST ASKED FOR IN THE PROMPT (same
"prompt-asks-code-enforces" pattern as project_agent.py's own checklist
grounding gate):
  1. GROUNDING — every note this module returns must share real vocabulary
     with something the search actually found (candidates/selected/
     checklist), exactly like _classify_grounding's "other"/"gap" cases in
     project_agent.py. A note that cites nothing real is dropped, not
     trusted, no matter how plausible it reads. See _grounded() below.
  2. UPDATE, NOT DUPLICATE — build_wiki_notes() is handed the project's
     EXISTING note titles before it ever calls the LLM, and the prompt is
     told to name an update target when one already covers the same
     concept. _match_existing() then normalizes both sides (case, "-" vs
     " ", trailing punctuation) so "GSDMD pyroptosis" and "GSDMD-Mediated
     Pyroptosis" match without needing the model to produce a byte-identical
     title.
  3. NEVER OVERWRITE A HUMAN EDIT — this module marks every note it
     proposes as an update or a create; it never decides on its own whether
     that update is SAFE to apply. That decision needs `is_human_edited`,
     which lives in the database, not in this module's in-memory
     `existing_notes` summaries (see build_wiki_notes' docstring for exactly
     what it's handed and why that's enough to decide update-vs-create but
     NOT enough to decide overwrite-vs-refuse). The actual refusal happens
     in frontend/lib/server/wikiNotes.ts's saveWikiNotes(), which is the
     thing that reads the full current row immediately before writing.
"""

from __future__ import annotations

import json
import logging
import re
import time

import llm

logger = logging.getLogger(__name__)

MAX_NOTES = 6            # cap on how many notes one run proposes
MAX_NOTE_CONTEXT = 20     # cap on how many existing notes ride along as memory
_JSON_RETRY_BACKOFF_SEC = 2.0

_NOTE_TYPES = ("concept", "entity", "question")


# ── slugs, matching, teasers ──────────────────────────────────────────────────


def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").strip().lower()).strip("-")
    return s or "note"


def _normalize_title(title: str) -> str:
    """Loose match key for "is this the same note" — same intent as
    project_agent.py's existing_labels.lower() dedupe, extended to treat a
    hyphen and a space as equivalent (models are inconsistent about which
    they use for a compound term like "GSDMD-mediated pyroptosis").
    Confirmed on a real run: the same model call mixes plain ASCII '-' with
    Unicode non-breaking hyphens/dashes (U+2010-U+2015, e.g. "IL‑1β" with
    U+2011) across a project's own note titles — both are folded to a plain
    space here, not just ASCII '-', so a rename between hyphen styles still
    matches."""
    normalized = re.sub(r"[‐-―]", "-", title or "")
    return re.sub(r"[\s\-]+", " ", normalized.strip().lower()).strip()


def _match_existing(title: str, existing_notes: list[dict]) -> dict | None:
    key = _normalize_title(title)
    for note in existing_notes:
        if _normalize_title(note.get("title", "")) == key:
            return note
    return None


def note_teaser(body: str, max_chars: int = 160) -> str:
    """First sentence (or max_chars, whichever is shorter) of a note's body,
    with [[link]] brackets stripped — what a reader/the agent's own memory
    context sees instead of the full body. Titles + teasers, never full
    bodies, is the whole point of MAX_NOTE_CONTEXT: see build_wiki_notes."""
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", body or "").strip()
    text = re.sub(r"\s+", " ", text)
    m = re.search(r"[.!?](\s|$)", text)
    cut = m.end() if m else len(text)
    cut = min(cut, max_chars)
    teaser = text[:cut].strip()
    if cut < len(text):
        teaser = teaser.rstrip(".") + "…"
    return teaser


def context_for_prompt(existing_notes: list[dict]) -> list[dict]:
    """Titles + teasers only, capped at MAX_NOTE_CONTEXT — the agent's
    "memory" of what it already concluded. `existing_notes` here is exactly
    what build_wiki_notes was handed (see its docstring): title, note_type,
    body, is_human_edited. Full bodies are dropped before this ever reaches
    the LLM call, on purpose (see the module doing the token-cost math in
    the stage-1 report, not here — this function just enforces the cap)."""
    out = []
    for note in existing_notes[:MAX_NOTE_CONTEXT]:
        out.append({
            "title": note.get("title"),
            "note_type": note.get("note_type"),
            "teaser": note_teaser(note.get("body") or ""),
        })
    return out


# ── grounding gate (same shape as project_agent.py's _classify_grounding) ────

_GROUNDING_STOPWORDS = {
    "this", "that", "with", "from", "into", "using", "study", "studies",
    "research", "project", "paper", "papers", "dataset", "datasets", "trial",
    "trials", "grant", "grants", "about", "which", "there", "their", "these",
    "those", "would", "could", "should", "based", "found", "relevant",
    "related", "results", "result", "information", "provides", "provide",
    "note", "notes", "concept", "entity", "question",
}


def _content_words(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{3,}", (text or "").lower())
        if w not in _GROUNDING_STOPWORDS
    }


def _found_vocab(candidates: list[dict], selected: list[dict], checklist_items: list[dict]) -> set[str]:
    vocab: set[str] = set()
    for item in candidates:
        vocab |= _content_words(item.get("title")) | _content_words(item.get("summary"))
    for item in selected:
        vocab |= _content_words(item.get("reason"))
    for item in checklist_items:
        vocab |= _content_words(item.get("label")) | _content_words(item.get("rationale"))
    return vocab


def _grounded(body: str, vocab: set[str]) -> bool:
    """THE GATE: a note's body must share real content-word vocabulary with
    something this run actually found — same discipline as the checklist's
    grounding gate, applied to a note instead of a checklist item. A note
    that reads as plausible domain knowledge but cites nothing this run
    actually turned up is dropped, not trusted."""
    return bool(_content_words(body) & vocab)


# ── the LLM step ──────────────────────────────────────────────────────────────

_WIKI_SYSTEM = (
    "You are maintaining a research project's private wiki — its running memory "
    "of what the team has learned. You will be given the project's goal, a list "
    "of items a search actually found (papers, trials, tools, datasets, etc.), "
    "the team's checklist, and the wiki's EXISTING notes (title + one-line teaser "
    "for each).\n\n"
    "A NOTE IS A CONCEPT OR ENTITY THE PROJECT CARES ABOUT — a target, a "
    "mechanism, a pathway, a cell type, a disease, or an explicit open question "
    "the team still needs to resolve. A note is NEVER a paper, dataset, trial, "
    "or compound — those are citations you mention INSIDE a note's body, never "
    "titles of notes themselves. Do not propose a note titled after a paper, "
    "dataset, or trial.\n\n"
    "EVERY FACTUAL SENTENCE in a note's body must be grounded in something the "
    "search actually found (name what kind of thing supports it — a paper, a "
    "trial, a tool, a dataset — in your own words, never quote a title). If the "
    "team has an open question the search did NOT resolve, say so as a "
    "question note instead of inventing an answer.\n\n"
    "Link to other notes by writing [[Note Title]] inline in the body, using "
    "either an EXISTING note's exact title (from the list you were given) or a "
    "new note title you are also proposing this run.\n\n"
    "UPDATE, DON'T DUPLICATE: before proposing a new note, check the existing "
    "notes list. If one already covers the same concept, propose an UPDATE to "
    "it — set \"target_title\" to that note's EXISTING title exactly as given — "
    "with a body that folds in what's new rather than repeating what the "
    "teaser already says. Only propose a brand-new note when nothing existing "
    "covers the concept.\n\n"
    f'Propose at most {MAX_NOTES} notes — fewer is fine, and zero is a valid '
    "outcome if this run found nothing that changes the wiki.\n\n"
    'Return ONLY a JSON object: {"notes": [{"title": "<concept or entity name>", '
    '"note_type": "concept|entity|question", "body": "<markdown, with [[links]] '
    'inline>", "target_title": "<existing note title to update, or null for a '
    'new note>"}]}. No prose, no code fences."'
)


def _loads_lenient(content: str | None) -> dict:
    if not content:
        return {}
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError):
        pass
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
    return {}


def _try_build_once(
    goal_summary: str,
    found_summary: list[dict],
    checklist_summary: list[dict],
    existing_context: list[dict],
    vocab: set[str],
) -> tuple[list[dict], int] | None:
    """One attempt at the wiki call + parse + grounding gate. Returns
    (notes, dropped_count) on success — notes may legitimately be [].
    Returns None only when the JSON itself couldn't be used (caller decides
    whether to retry). Raises on an actual LLM-call exception, same
    distinction project_agent.py's own two LLM steps make."""
    resp = llm.complete(
        [
            {"role": "system", "content": _WIKI_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"GOAL: {goal_summary}\n\n"
                    f"Found items: {json.dumps(found_summary)}\n\n"
                    f"Checklist: {json.dumps(checklist_summary)}\n\n"
                    f"Existing notes: {json.dumps(existing_context)}\n\n"
                    'Return ONLY {"notes": [{"title": "...", "note_type": "...", '
                    '"body": "...", "target_title": null}]}.'
                ),
            },
        ],
        temperature=0.3,
    )
    data = _loads_lenient(resp.content)
    raw = data.get("notes") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None

    out: list[dict] = []
    dropped = 0
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title")
        body = entry.get("body")
        note_type = entry.get("note_type")
        if not isinstance(title, str) or not title.strip():
            continue
        if not isinstance(body, str) or not body.strip():
            continue
        if note_type not in _NOTE_TYPES:
            note_type = "concept"

        # THE GATE: drop anything that cites nothing this run actually found.
        if not _grounded(body, vocab):
            dropped += 1
            logger.warning("wiki_agent: dropped ungrounded note %r", title.strip())
            continue

        target_title = entry.get("target_title")
        out.append({
            "title": title.strip()[:200],
            "note_type": note_type,
            "body": body.strip(),
            "target_title": target_title.strip() if isinstance(target_title, str) and target_title.strip() else None,
        })
        if len(out) >= MAX_NOTES:
            break
    return out, dropped


def _resolve_actions(notes: list[dict], existing_notes: list[dict]) -> list[dict]:
    """Turns each {title, note_type, body, target_title} into a save
    instruction: {slug, title, note_type, body, action: "update"|"create",
    note_id (only for update)}. `target_title` from the model AND a plain
    same-title match both count as "this covers an existing note" — a model
    that names the target itself in `title` (instead of using
    `target_title`) still gets matched, so the update-not-duplicate rule
    doesn't silently fail just because the model skipped a field."""
    out = []
    for note in notes:
        target = note.get("target_title") or note.get("title")
        match = _match_existing(target, existing_notes) if target else None
        if match is None:
            match = _match_existing(note["title"], existing_notes)
        if match is not None:
            out.append({
                "action": "update",
                "note_id": match.get("id"),
                "slug": match.get("slug"),
                "title": note["title"],
                "note_type": note["note_type"],
                "body": note["body"],
            })
        else:
            out.append({
                "action": "create",
                "note_id": None,
                "slug": slugify(note["title"]),
                "title": note["title"],
                "note_type": note["note_type"],
                "body": note["body"],
            })
    return out


def build_wiki_notes(
    goal_summary: str,
    candidates: list[dict],
    selected: list[dict],
    checklist_items: list[dict],
    existing_notes: list[dict],
) -> tuple[list[dict], bool, int]:
    """Returns (note proposals, used_fallback, dropped_count).

    `existing_notes` is read by the CALLER before this run starts (see
    run_project_agent_async in project_agent.py and
    frontend/lib/server/wikiNotes.ts's listWikiNoteSummaries) and passed in
    as [{id, slug, title, note_type, body}, ...] for every note this project
    already has — the FULL set, not capped here, because _match_existing
    needs to be able to find a match against any of them, not just the ones
    that made it into the LLM's own memory context (see context_for_prompt,
    which IS capped at MAX_NOTE_CONTEXT, separately, for what the model
    itself sees).

    `used_fallback=True` means the LLM call/JSON failed outright — the
    proposal is [] in that case, never a guess; there is no "fall back to
    unranked notes" here, same fail-closed stance as project_agent.py's
    relevance pass, because an ungrounded/unreviewed note is worse than no
    note. An EMPTY result with used_fallback=False is a legitimate,
    different outcome: the model ran fine and genuinely found nothing worth
    writing down this run."""
    if not candidates and not selected and not checklist_items:
        return [], False, 0

    vocab = _found_vocab(candidates, selected, checklist_items)
    found_summary = [
        {"kind": c.get("kind"), "title": c.get("title")} for c in candidates[:60]
    ]
    checklist_summary = [
        {"label": c.get("label")} for c in checklist_items
    ]
    existing_context = context_for_prompt(existing_notes)

    try:
        result = _try_build_once(goal_summary, found_summary, checklist_summary, existing_context, vocab)
        if result is None:
            logger.warning("wiki_agent: notes JSON unusable (attempt 1/2), retrying once")
            time.sleep(_JSON_RETRY_BACKOFF_SEC)
            result = _try_build_once(goal_summary, found_summary, checklist_summary, existing_context, vocab)
        if result is None:
            logger.warning("wiki_agent: notes JSON unusable (attempt 2/2)")
            return [], True, 0
        notes, dropped = result
        return _resolve_actions(notes, existing_notes), False, dropped
    except Exception:
        logger.exception("wiki_agent: notes LLM call failed")
        return [], True, 0
