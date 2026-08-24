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


# ── evidence filing (stage 2) ─────────────────────────────────────────────────
#
# WHY CODE, NOT ANOTHER LLM CALL: an assignment must be "justifiable from
# the item's own text, not guessed" (the spec's own words) — a direct
# vocabulary-overlap check between the item's title/summary and the note's
# title/body already IS that justification, visibly and reproducibly,
# without spending a 57th LLM call asking the model to re-read every
# candidate against every note. This is the same "the gate is code, not a
# prompt" stance as _grounded() above and project_agent.py's checklist gate
# — just applied here as the PRIMARY mechanism instead of a filter on top of
# an LLM's own output, because there's no LLM output to filter in the first
# place.
#
# WHY DISTINCTIVE WORDS, NOT ANY SHARED WORD: on a real single-target,
# single-indication project (e.g. every candidate and every note mentions
# "NLRP3" and "kidney") a plain content-word overlap check would file nearly
# every candidate under nearly every note — technically grounded, useless as
# organization. _distinctive_vocab() below drops any word that appears in
# more than half of the project's OWN notes — the project-wide vocabulary
# every note already shares — so a filing has to turn on what makes THIS
# note different from the others, not on the target/indication every note
# already mentions in its title.

_DISTINCTIVE_DF_RATIO = 0.5   # a word in > this fraction of notes is "generic to the project"
# 2, not 1 — confirmed necessary on a real run: a single shared word is too
# easy to hit by accident on generic academic-writing filler ("through",
# "insights", "molecular", "reviews") that survives _content_words' length
# filter and isn't excluded by _distinctive_vocab either (it doesn't recur
# across ENOUGH of a small note set to trip the >50% generic-to-the-project
# cutoff, but it's still not evidence of anything). Two independent shared
# words is a real, harder-to-fake signal that the item's own text and the
# note's own text are actually about the same thing, not sharing one
# incidental word. A LONG, unambiguous domain term (>= _LONG_TERM_CHARS)
# still counts alone — "pyroptosis"/"inflammasome"/"gasdermin" are not
# accidental matches at that length.
_MIN_SHARED_DISTINCTIVE_WORDS = 2
_LONG_TERM_CHARS = 10

# WHY THIS EXISTS, ON TOP OF _distinctive_vocab: _distinctive_vocab only
# strips a word that recurs in > half of THIS PROJECT'S OWN notes — it has
# no idea a word is generic across biomedical literature AT LARGE unless
# this particular project's notes happen to overuse it too. Confirmed on a
# real run (NLRP3 project): a paper on immune regulation in a hypoxia-
# stressed Tibetan fish (Gymnocypris eckloni) filed under a human kidney
# inflammasome note on the strength of "however", "pathways", "signaling" —
# none of those name anything about NLRP3, kidneys, or diabetes; they are
# words that appear in nearly any molecular-biology abstract regardless of
# organism or disease. Every one of them independently passed
# _distinctive_vocab (this specific project's notes don't happen to repeat
# them enough to trip that project-local >50% cutoff) and _content_words'
# length filter, so the ONLY thing that stopped a fish paper from filing
# under a kidney note was luck.
#
# THIS IS A STOPWORD LIST, NOT A HIGHER THRESHOLD — the user's own explicit
# constraint. _MIN_SHARED_DISTINCTIVE_WORDS stays at 2; what changes is
# which words are even eligible to count toward that 2. A word here is one
# that describes HOW science is done or reported (a process, an effect, a
# measurement, a hedge) rather than WHAT the science is about (a gene, a
# disease, a cell type, a compound, an organism) — the latter is exactly
# what _distinctive_vocab already can't reliably tell apart from the former
# on its own, because both survive its recurrence check equally well on a
# small note set. Domain nouns (gsdmd, pyroptosis, inflammasome, tubules,
# diabetic) are deliberately NOT here — stripping those would thin the map,
# which the user explicitly ruled out; this list only removes vocabulary
# that was never going to be evidence of shared subject matter.
_GENERIC_SCIENCE_STOPWORDS = {
    # hedges / connectives that show up in nearly every abstract
    "however", "therefore", "moreover", "furthermore", "additionally",
    "thus", "whereas", "likewise", "similarly", "similar", "comparable",
    "compared", "regarding", "following", "through", "them", "these",
    "those", "several", "various", "different", "differences", "existing",
    "exists", "remains", "remained", "provided", "including", "includes",
    "also", "most", "under", "were",
    # generic process/effect/measurement vocabulary — describes HOW a
    # finding was made, not WHAT it's about
    "showed", "shown", "observed", "identified", "investigated",
    "elucidated", "highlight", "highlighted", "suggest", "suggests",
    "suggested", "indicate", "indicates", "indicated", "demonstrate",
    "demonstrated", "reveal", "revealed", "associated", "association",
    "correlated", "correlation", "involved", "involvement", "regulation",
    "regulated", "regulatory", "expression", "expressed", "levels",
    "level", "signaling", "signalling", "pathway", "pathways", "effect",
    "effects", "response", "responses", "mechanism", "mechanisms",
    "process", "processes", "activation", "activated", "induced", "induce",
    "inhibition", "inhibited", "treatment", "treated", "model", "models",
    "function", "functional", "role", "roles", "target", "targets",
    "targeting", "mediated", "driven", "dependent", "independent",
    "significant", "significantly", "potential", "novel", "important",
    "key", "critical", "major", "primary", "secondary", "further",
    "additional", "recent", "current", "previous", "prior", "analysis",
    "analyzed", "patterns", "profile", "profiles", "factor", "factors",
    "system", "systems", "network", "networks", "stress", "damage",
    "exposure", "outcome", "outcomes", "strategies", "strategy",
    "enrichment", "enriched", "immune", "immune-related",
    # generic clinical/methodology nouns that still cross-matched unrelated
    # diseases on a real run (a transthyretin-amyloidosis trial filed under
    # a diabetic-kidney-disease note on "cohort"+"patients" alone)
    "patients", "patient", "cohort", "cohorts", "versus", "both", "human",
    "humans", "small", "protein", "proteins", "single",
    # long (>= _LONG_TERM_CHARS) but still generic — would otherwise stand
    # alone under the long-unambiguous-term bypass below, exactly what let
    # "measurements"/"transcriptomic"/"pharmacological" file a study or a
    # KEGG pathway page under an unrelated note on a real run
    "measurements", "measurement", "transcriptomic", "transcriptomics",
    "pharmacological", "pharmacology", "structural", "experimental",
    # pure function words / connectives — the >=4-char length filter in
    # _content_words lets these through, and they carry zero topical signal
    # in ANY context (unlike "structure"/"tissue"/"interaction", which
    # sometimes do) — cheap to remove with no recall cost, confirmed on a
    # real run: every match that used to rest on one of these also had
    # independent real signal elsewhere, so removing them only dropped the
    # weak half of an already-passing pair, never an item's only filing.
    "where", "while", "have", "whether", "across", "such", "many",
}


def _distinctive_content_words(text: str) -> set[str]:
    """Same as _content_words, minus vocabulary that's generic across
    biomedical literature at large — see _GENERIC_SCIENCE_STOPWORDS' own
    comment. Used ONLY for evidence filing's distinctive-overlap check
    (file_evidence/_distinctive_vocab below); _grounded()'s gate keeps
    using plain _content_words, since grounding a note's PROSE in what the
    search found is a lower, deliberately looser bar than filing one item
    under one specific concept."""
    return {w for w in _content_words(text) if w not in _GENERIC_SCIENCE_STOPWORDS}


_CANDIDATE_DF_RATIO = 0.10  # a word in >= this fraction of THIS RUN'S candidate
# items is "generic to this project's domain" — the static stopword list above
# catches vocabulary generic across ALL of biomedical literature ("however",
# "expression", "signaling"), but on a real run a title-anchored match still
# filed on lone words like "molecular", "cohort", "patients", "inhibitors",
# "cells" — not on the static list (each is a real, sometimes-meaningful
# word) but generic FOR THIS PROJECT: an NLRP3/kidney-disease project's own
# candidate pool is saturated with them (nlrp3, disease, kidney, cell,
# inflammasome, molecular, inflammation, cells, injury, inflammatory,
# diabetes... each recurring in 10-35% of the 67 real candidates). A fixed
# list can never anticipate that — it's a property of THIS project's search
# results, not of English. Computed fresh per run, the same way
# _distinctive_vocab already strips project-generic vocabulary from NOTES;
# this does the same thing over the CANDIDATE POOL instead.
def _candidate_generic_words(candidates: list[dict]) -> set[str]:
    if len(candidates) < 5:
        return set()
    df: dict[str, int] = {}
    for item in candidates:
        words = _distinctive_content_words(item.get("title")) | _distinctive_content_words(item.get("summary"))
        for w in words:
            df[w] = df.get(w, 0) + 1
    threshold = _CANDIDATE_DF_RATIO * len(candidates)
    return {w for w, count in df.items() if count >= threshold}


def _distinctive_vocab(notes_vocab: list[set[str]]) -> list[set[str]]:
    """notes_vocab[i] is note i's raw content-word set (title + body). Returns
    the same list with every word that recurs in more than
    _DISTINCTIVE_DF_RATIO of the notes removed from EVERY note's set — e.g.
    "nlrp3" and "kidney", present in nearly every note of an NLRP3-kidney
    project, are dropped from all of them; a word specific to two or three
    notes survives in exactly those. A single-note project has no generic
    vocabulary to strip (nothing can recur in "more than half of 1 note"),
    so this is a no-op there — the distinction only matters once a project
    has enough notes to actually be generic across."""
    if len(notes_vocab) <= 1:
        return notes_vocab
    df: dict[str, int] = {}
    for words in notes_vocab:
        for w in words:
            df[w] = df.get(w, 0) + 1
    threshold = _DISTINCTIVE_DF_RATIO * len(notes_vocab)
    generic = {w for w, count in df.items() if count > threshold}
    return [words - generic for words in notes_vocab]


def curate_evidence_item(item: dict) -> dict:
    """The persistence shape for one evidence item — same discipline as
    ChEMBL's own `raw` curation (sources/chembl.py): named fields only,
    never the item's `raw` dict (itself already curated per-source, but
    shaped for that source's own ItemCard rendering, not for cross-source
    storage — see 2026-08-24_wiki_evidence.sql's own CURATION note) and
    never `dedupe_key` (an internal plumbing detail this table has no use
    for). Matches project_evidence_items' columns 1:1 so
    frontend/lib/server/wikiEvidence.ts can insert this dict close to
    verbatim."""
    signal = item.get("signal") or {}
    return {
        "item_id": item.get("id"),
        "kind": item.get("kind"),
        "title": item.get("title"),
        "summary": item.get("summary"),
        "url": item.get("url"),
        "source": item.get("source"),
        "date_iso": item.get("date_iso"),
        "signal_metric": signal.get("metric"),
        "signal_value": signal.get("value"),
        "signal_as_of": signal.get("as_of"),
    }


def file_evidence(candidates: list[dict], notes: list[dict]) -> tuple[dict[str, list[dict]], list[dict]]:
    """Assigns each candidate item to zero or more notes. Returns
    (filings, unfiled) where `filings` maps a note's `slug` — NOT its
    database id — to the list of {item, shared_terms} filed under it, and
    `unfiled` is every candidate that matched no note at all — never
    dropped, see this migration's own "store them against the project with
    no note" rule (2026-08-24_wiki_evidence.sql); the caller persists
    `unfiled` too, just with no wiki_note_evidence row pointing at it.

    KEYED BY SLUG, NOT ID: a note this same run just decided to CREATE
    (action="create" in build_wiki_notes' output) has no database id yet —
    it's only minted once frontend/lib/server/wikiNotes.ts actually inserts
    the row. slug is deterministic (slugify(title), computed here in
    Python) and known before that insert happens, so it's what this
    function returns and what saveWikiNotes() resolves to a real note id
    (via the same upsert that creates/updates the note) right before
    inserting wiki_note_evidence rows. This mirrors _resolve_actions' own
    slug-first design one function up.

    `notes` is [{slug, title, body}, ...] — the project's notes AFTER this
    run's build_wiki_notes proposals are folded in (so a brand-new note can
    receive evidence filed in the same run), which the caller assembles
    from existing_notes + this run's create/update proposals; it does not
    need to be the database's current state. `candidates` is the same
    dicts _flatten_candidates produces (id, kind, title, summary, source,
    url, ...) — never mutated, only read.

    An item may legitimately file under MORE than one note (a shared
    dataset citing both a mechanism note and a drug note, the real case
    that ruled out storing items inline on a note — see the migration's own
    "an item can be evidence for more than one note" section)."""
    if not candidates or not notes:
        return {}, list(candidates)

    # WHY NO "TITLE ANCHOR" REQUIREMENT: an earlier version of this fix also
    # required a shared word to be drawn from the note's own title, on top
    # of the two checks below. Tried live against the same 67 real
    # candidates: it did keep the fish and a cross-disease trial out, but
    # it also cut filed items roughly in half (60% -> 30%) — most of what
    # it removed was NOT further noise, it was ordinary items that
    # genuinely share real vocabulary with a note's BODY but happen not to
    # repeat a word from that note's (often short, narrow) title. Per this
    # project's own stated tradeoff — a wrong-looking item costs less than
    # a map that quietly went from 40% to 70% unfiled — that trade wasn't
    # worth it, so it's gone; the two checks below carry the fix alone now.
    generic = _candidate_generic_words(candidates)
    notes_vocab_raw = [
        (_distinctive_content_words(n.get("title")) | _distinctive_content_words(n.get("body"))) - generic
        for n in notes
    ]
    notes_vocab = _distinctive_vocab(notes_vocab_raw)

    filings: dict[str, list[dict]] = {n["slug"]: [] for n in notes}
    unfiled: list[dict] = []

    for item in candidates:
        item_words = (
            _distinctive_content_words(item.get("title")) | _distinctive_content_words(item.get("summary"))
        ) - generic
        best_matches: list[tuple[dict, set[str]]] = []
        for note, vocab in zip(notes, notes_vocab):
            shared = item_words & vocab
            long_enough_alone = any(len(w) >= _LONG_TERM_CHARS for w in shared)
            if len(shared) >= _MIN_SHARED_DISTINCTIVE_WORDS or long_enough_alone:
                best_matches.append((note, shared))
        curated = curate_evidence_item(item)
        if not best_matches:
            unfiled.append(curated)
            continue
        for note, shared in best_matches:
            filings[note["slug"]].append({"item": curated, "shared_terms": sorted(shared)})

    return filings, unfiled


# Kinds that are evidence FOR THE PROJECT rather than for any concept a note
# could name. A grant record's own text is administrative (funding
# mechanism, institute, amount) — it isn't a claim about a mechanism the way
# a paper or dataset is, even when the target gene appears in its title, so
# it was never going to be a hit under file_evidence()'s grounding gate. A
# clinical trial is the same shape MOST of the time (a trial testing an
# SGLT2 inhibitor's renal outcomes doesn't make a claim about GSDMD/IL-1beta
# biology) but NOT always — a trial of a compound a note is specifically
# about (e.g. tranilast) genuinely IS evidence for that note, and
# file_evidence() already files it there correctly today, vocabulary
# overlap and all. THIS SET IS NEVER USED TO GATE MATCHING — see
# file_evidence() above, unchanged — it is used ONLY by split_unfiled()
# below, after matching has already happened, to decide what an ITEM THAT
# MATCHED NOTHING means: a grant/trial that matched nothing is not a sign
# the wiki is missing a note, it's a sign the item was never conceptual in
# the first place.
_PROJECT_LEVEL_KINDS = {"grant", "trial"}


def split_unfiled(unfiled: list[dict]) -> tuple[list[dict], list[dict]]:
    """Splits file_evidence()'s own `unfiled` list into (real_unfiled,
    project_level) — called AFTER file_evidence(), never inside it, so a
    grant/trial that DID match a note (real vocabulary overlap, same gate
    as everything else) never reaches this function at all; it already
    left `unfiled` before this split ever runs. Only an item that matched
    NOTHING gets reclassified here, purely by kind:
      real_unfiled   — everything else: a paper/dataset/tool/geneset/target
                        that matched no note. This is what suggest_missing_
                        notes() should run over — a genuine "maybe there's a
                        concept missing" signal.
      project_level  — a grant or trial that matched no note. Real evidence
                        that the project has funding/a trial in its space,
                        but not a claim to check a note's vocabulary
                        against, so it doesn't belong in the "did we miss a
                        note" pool. Still persisted identically to
                        real_unfiled (same project_evidence_items row, no
                        wiki_note_evidence row) — this is a display/
                        reporting distinction, not a storage one; no schema
                        change backs it."""
    real_unfiled = [item for item in unfiled if item.get("kind") not in _PROJECT_LEVEL_KINDS]
    project_level = [item for item in unfiled if item.get("kind") in _PROJECT_LEVEL_KINDS]
    return real_unfiled, project_level


def suggest_missing_notes(unfiled: list[dict], min_group_size: int = 3, top_terms: int = 3) -> list[dict]:
    """"If unfiled items share obvious common terms, surface that as a
    suggestion that a note may be missing. Only if it falls out naturally"
    (the spec's own words) — this is deliberately NOT a clustering system:
    it counts content-word document frequency across unfiled items ONLY
    (never the filed ones — a term already covered by a note isn't a
    missing-note signal) and reports a term as a suggestion only when it
    recurs in at least `min_group_size` distinct unfiled items. No
    similarity metric, no grouping algorithm — a term either recurs enough
    to say something, or it doesn't. Returns
    [{term, count, item_ids}, ...], most frequent first, capped at
    `top_terms` — a longer list would be presenting noise as signal."""
    if len(unfiled) < min_group_size:
        return []
    df: dict[str, list[str]] = {}
    for item in unfiled:
        words = _content_words(item.get("title")) | _content_words(item.get("summary"))
        for w in words:
            df.setdefault(w, []).append(item.get("item_id"))
    candidates = [
        {"term": term, "count": len(ids), "item_ids": ids}
        for term, ids in df.items()
        if len(ids) >= min_group_size
    ]
    candidates.sort(key=lambda c: c["count"], reverse=True)
    return candidates[:top_terms]
