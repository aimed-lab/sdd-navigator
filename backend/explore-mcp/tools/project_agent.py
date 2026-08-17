"""
tools/project_agent.py — the project agent: a FIXED pipeline that reads a
project's stated goal, searches across all our sources ONCE, and produces
TWO outputs from that one search — resources + checklist items for a human
to review and accept, AND a downloadable prior-art digest — in one run.

WHY A FIXED PIPELINE, NOT AN AUTONOMOUS TOOL-CHOOSING LOOP: same reasoning as
tools/explore.py's JSON routing — Groq's native function calling is unreliable
for parallel tool calls on this model, so nothing here lets the LLM freely pick
what to call next. The steps below always run in the same order, with the LLM
doing one bounded job per step and every step degrading independently rather
than failing the whole run.

ONE RUN, TWO OUTPUTS — WHY THIS USED TO BE TWO PIPELINES. The prior-art digest
(tools/prior_art_brief.py) and the resource/checklist proposals below both
want the same candidate pool: papers/tools/datasets/gene sets for this
project's target and mechanism. They used to each run their OWN
explore_async() call over the same goal text — two full searches, two sets of
scope-extraction/routing Groq calls, to produce two outputs a researcher asked
for with one click. Collecting once and rendering both outputs from the same
`explore_result` cuts that duplication; see run_project_agent_async below for
where the single search happens and where each output branches off it.

THE STEPS
  1. Scope + search — reuse explore_async() verbatim over "name. description",
     exactly the free-text path tools/explore.py already proves works better
     than concatenated keywords. Run IN PARALLEL with the two status-filtered
     trial searches the digest needs (TERMINATED/WITHDRAWN and RECRUITING) —
     those are direct HTTP calls with no LLM in them, independent of scope
     extraction, so there's no reason to serialize them after it.
  1b. Digest render — pure string formatting (tools/prior_art_brief.py,
      render_digest()) over what step 1 already collected. No LLM, no
      network — see that module's own "hard constraint" docstring. Rendered
      unconditionally whenever the search itself succeeded, independent of
      whether steps 2/3 below succeed — a relevance-pass failure has nothing
      to do with whether the digest (which never calls an LLM) is trustworthy.
  2. Relevance pass — given the project's stated goal and the candidate items
     from step 1, ask the LLM to select the most relevant ones and justify each
     pick against the goal (not just topical overlap). This is the step that
     makes the output read as reasoning, not a re-sorted search page.
  3. Checklist proposal — given the project description and what step 1 & 2
     actually found, ask the LLM for concrete next steps and gaps, grounded in
     the findings, skipping anything that duplicates an existing item. SKIPPED
     entirely for a ColaboFest project — see run_project_agent_async's own
     docstring.

WRITES NOTHING. This module (and the HTTP route in server.py that calls it)
never touches Supabase — it returns a proposal; the frontend is the only thing
that persists anything, through the existing saveToProject/addChecklistItem
paths (see CLAUDE.md's "IT PROPOSES; THE FRONTEND PERSISTS").
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time

import llm
from models import Item
from tools.explore import explore_async
from tools.prior_art_brief import RECRUITING_LIMIT, TRIAL_LIMIT, render_digest, trial_query as digest_trial_query
from tools.search_trials import search_trials_async

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 60      # cap on how many items step 2 is asked to reason over
MAX_SELECTED = 8         # cap on how many items the agent proposes to save
MAX_CHECKLIST = 6        # cap on how many checklist items the agent proposes

# A malformed-JSON response (the model returned prose, truncated JSON, or
# something _loads_lenient just can't parse into the expected shape) is
# usually a transient sampling hiccup, NOT a quota — a real 429/quota error
# raises out of llm.complete() as an exception and is a SEPARATE code path
# below (still not retried: hammering a quota error again immediately would
# make it worse, not better). ONE retry, short backoff, on the JSON-unusable
# path only. If the retry ALSO comes back unusable, this falls closed
# exactly as before — no weakening of that guarantee, just fewer runs that
# die to what's usually a one-off bad sample.
_JSON_RETRY_BACKOFF_SEC = 2.0


# ── input shaping ─────────────────────────────────────────────────────────────


def _project_goal_text(project: dict) -> str:
    """Same "name + description beats keywords" input explore_async already
    wants — see tools/explore.py's own docstring and CLAUDE.md's step 1 note.
    target/indication/modality/stage ride along as plain sentence fragments so
    they inform scope extraction without being force-fit into a keyword list."""
    parts = []
    name = (project.get("name") or "").strip()
    description = (project.get("description") or "").strip()
    if name:
        parts.append(name)
    if description:
        parts.append(description)
    extra = []
    for key in ("target", "indication", "modality", "stage"):
        value = (project.get(key) or "").strip()
        if value:
            extra.append(value)
    if extra:
        parts.append(" ".join(extra))
    return ". ".join(parts)


def _goal_summary(project: dict) -> str:
    """One line describing what the team said they're trying to do — what the
    relevance/checklist prompts are told to justify picks against."""
    bits = [project.get("name") or "this project"]
    if project.get("description"):
        bits.append(f"— {project['description']}")
    tail = [project.get(k) for k in ("target", "indication", "modality", "stage") if project.get(k)]
    if tail:
        bits.append(f"({', '.join(tail)})")
    return " ".join(bits)


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


# ── step 1: scope + search (delegates to explore_async verbatim), plus the
# two status-filtered trial searches the digest needs ────────────────────────


async def _search(project: dict, goal_text: str) -> tuple[dict, list, list, bool]:
    """Runs the shared explore_async() search and the digest's two direct,
    status-filtered trial searches IN PARALLEL — the trial calls are plain
    HTTP with no LLM in them and don't depend on explore_async's own scope
    extraction, so there's no reason to wait for one before starting the
    others. Returns (explore_result, stopped_trial_items, recruiting_items,
    search_failed); each of the three searches degrades to an empty/default
    value independently on failure. `search_failed` is True only when
    explore_async itself failed (the resource/checklist candidate pool AND
    the digest's papers/tools/datasets/genesets sections all come from it) —
    a trial-search failure alone doesn't set it, since the digest can still
    honestly report "returned none" for those two sections on its own."""
    query = digest_trial_query(project, goal_text)
    explore_result, stopped, recruiting = await asyncio.gather(
        explore_async(goal_text),
        search_trials_async(query, TRIAL_LIMIT, status_filter=["TERMINATED", "WITHDRAWN"]),
        search_trials_async(query, RECRUITING_LIMIT, status_filter=["RECRUITING"]),
        return_exceptions=True,
    )
    search_failed = isinstance(explore_result, Exception)
    if search_failed:
        logger.exception("project_agent: search step failed entirely", exc_info=explore_result)
        explore_result = {"sections": [], "tools_called": [], "reasoning": None}
    if isinstance(stopped, Exception):
        logger.exception("project_agent: stopped-trials search failed", exc_info=stopped)
        stopped = []
    if isinstance(recruiting, Exception):
        logger.exception("project_agent: recruiting-trials search failed", exc_info=recruiting)
        recruiting = []
    return explore_result, stopped, recruiting, search_failed


# Kinds excluded from the AGENT's candidate pool only — explore_async() and
# everything in tools/explore.py stay completely untouched, this filters
# AFTER the shared search runs, right here in project_agent.py. "episode"
# (search_wiki, our own podcast-derived wiki pages) is dropped: on a real run
# against the ALS project it was 20 of 51 candidates (39% of the pool) and 0
# of them survived the relevance pass, while also eating into the
# MAX_CANDIDATES=60 cap ahead of sources that actually convert. Episodes stay
# genuinely useful for browsing in Explore — this exclusion is scoped to the
# agent's own flattening step, not the shared search.
_AGENT_EXCLUDED_KINDS = {"episode"}


def _flatten_candidates(
    explore_result: dict, excluded_ids: set[str]
) -> tuple[list[dict], list[str], int]:
    """All items across every section, deduped by id, in section order, with
    anything already saved to the project (`excluded_ids`) dropped BEFORE the
    relevance pass even sees it — so the LLM's limited selection budget goes
    on genuinely new items, not on re-proposing what's already there. Kinds
    in `_AGENT_EXCLUDED_KINDS` (currently just episodes) are dropped the same
    way, before excluded_ids or the cap ever see them.

    Returns (items, failed_tool_names, excluded_count) — the count is
    reported back to the caller so the summary can say honestly how much of
    what was found was already saved, rather than silently shrinking the
    candidate pool."""
    seen: set[str] = set()
    items: list[dict] = []
    failed: list[str] = []
    excluded_count = 0
    for section in explore_result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        if section.get("kind") in _AGENT_EXCLUDED_KINDS:
            continue
        if section.get("error"):
            failed.append(section.get("tool") or section.get("kind") or "unknown")
        for item in section.get("items") or []:
            item_id = item.get("id")
            if not item_id or item_id in seen:
                continue
            seen.add(item_id)
            if item_id in excluded_ids:
                excluded_count += 1
                continue
            items.append(item)
    return items, failed, excluded_count


# ── step 2: relevance pass ────────────────────────────────────────────────────

_RELEVANCE_SYSTEM = (
    "You are a research assistant helping a lab team decide what to save to their "
    "project. You will be given the team's stated GOAL and a list of candidate "
    "items found by searching papers, news, trials, grants, tools, datasets, gene "
    "sets, internal lab resources, people and wiki pages.\n\n"
    "Select ONLY the items that are genuinely relevant to what the team said they "
    "are trying to do — judge against the GOAL, not just topical overlap with a "
    "keyword. Skip anything generic or tangential. For each item you select, "
    "write ONE SHORT SENTENCE explaining why it matters for THIS project's goal "
    "specifically.\n\n"
    f"Select at most {MAX_SELECTED} items — fewer is fine if fewer are genuinely "
    "relevant. Never select an item just to fill the quota.\n\n"
    'Return ONLY a JSON object: {"selected": [{"id": "<item id>", "reason": '
    '"<one sentence>"}, ...]}. Use the exact `id` field from the candidate list. '
    "No prose, no code fences."
)


def _candidate_summary(item: dict) -> dict:
    """The slice of an Item the LLM actually needs to judge relevance —
    everything else (raw, dedupe_key, ...) would just spend tokens."""
    return {
        "id": item.get("id"),
        "kind": item.get("kind"),
        "title": item.get("title"),
        "summary": item.get("summary"),
        "source": item.get("source"),
    }


def _try_select_relevant_once(
    goal_summary: str, trimmed: list[dict], by_id: dict[str, dict]
) -> list[dict] | None:
    """One attempt at the relevance call + parse. Returns the selected items
    on success, or None if the JSON came back unusable (caller decides
    whether to retry). Raises on an actual LLM-call failure (a real
    exception, e.g. a quota error) — that's a distinct failure class the
    caller does NOT retry, see the module-level note on _JSON_RETRY_BACKOFF_SEC."""
    resp = llm.complete(
        [
            {"role": "system", "content": _RELEVANCE_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"GOAL: {goal_summary}\n\n"
                    f"Candidate items:\n{json.dumps(trimmed)}\n\n"
                    'Return ONLY {"selected": [{"id": "...", "reason": "..."}]}.'
                ),
            },
        ],
        temperature=0.2,
    )
    data = _loads_lenient(resp.content)
    raw = data.get("selected") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None
    out: list[dict] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        item_id = entry.get("id")
        reason = entry.get("reason")
        if not isinstance(item_id, str) or item_id not in by_id or item_id in seen:
            continue
        if not isinstance(reason, str) or not reason.strip():
            continue
        seen.add(item_id)
        out.append({**by_id[item_id], "reason": reason.strip()})
        if len(out) >= MAX_SELECTED:
            break
    return out or None


def _select_relevant(goal_summary: str, candidates: list[dict]) -> tuple[list[dict], bool]:
    """Returns (selected item dicts each carrying `reason`, used_fallback).
    Falls back to the first MAX_SELECTED candidates with a generic reason if
    the LLM call or its JSON can't be used — the proposal must never come back
    empty just because the relevance pass failed (see CLAUDE.md's partial-
    failure requirement).

    RETRY: malformed JSON (the model returned something _loads_lenient can't
    use) gets exactly ONE retry after a short backoff — that failure mode is
    usually a one-off bad sample, not a quota, so a single retry turns most
    of these into a ~2s delay instead of a dead run. An actual exception from
    llm.complete() itself (the call failing outright — a real rate limit,
    network error, etc.) is NOT retried here; that's a different failure
    class and immediately retrying a quota error only makes it worse."""
    if not candidates:
        return [], False

    by_id = {c["id"]: c for c in candidates}
    trimmed = [_candidate_summary(c) for c in candidates[:MAX_CANDIDATES]]

    try:
        out = _try_select_relevant_once(goal_summary, trimmed, by_id)
        if out is not None:
            return out, False
        logger.warning("project_agent: relevance JSON unusable (attempt 1/2), retrying once")
        time.sleep(_JSON_RETRY_BACKOFF_SEC)
        out = _try_select_relevant_once(goal_summary, trimmed, by_id)
        if out is not None:
            logger.info("project_agent: relevance JSON usable on retry (attempt 2/2)")
            return out, False
        logger.warning(
            "project_agent: relevance JSON unusable (attempt 2/2) — falling back to top candidates"
        )
    except Exception:
        logger.exception("project_agent: relevance LLM call failed, falling back to top candidates")

    fallback = [
        {**c, "reason": "Surfaced by the search for this project's goal (relevance ranking unavailable)."}
        for c in candidates[:MAX_SELECTED]
    ]
    return fallback, True


# ── step 3: checklist proposal ────────────────────────────────────────────────

# Chen: "make sure the checklist generated is a valid one, not some garbage."
# A prompt instruction alone ("GROUNDED in what was actually found") is not a
# gate — the LLM can and does ignore it under load. This is the actual gate:
# every item the LLM proposes is checked in code, after parsing, before it
# ever reaches the frontend. An item survives ONLY if its rationale either
# (a) shares real vocabulary with something step 1/2 actually found (a
# citation), or (b) names an explicit gap using one of the phrases below (no
# in vivo model was found, evidence is unclear, etc.). Anything that's
# neither — a plausible-sounding but unmoored sentence — is dropped, not
# trusted. Fewer defensible items beats six plausible ones, per Chen's words.
_GAP_PHRASES = (
    "no evidence", "no in vivo", "no in vitro", "not found", "not identified",
    "not addressed", "none of the", "no direct evidence", "no paper", "no dataset",
    "no clinical trial", "no trial", "unclear whether", "unclear if", "is unclear",
    "was not found", "were not found", "no study", "no studies", "gap in",
    "missing from", "not available", "did not find", "we found no", "lack of",
    "lacks", "no existing", "not yet established", "remains unclear",
    "remains unknown", "unknown whether",
)

# Words too generic to count as a real citation match on their own (stopwords
# plus a few domain-generic terms that show up in nearly every title/summary
# and would let almost any sentence "match" by accident).
_GROUNDING_STOPWORDS = {
    "this", "that", "with", "from", "into", "using", "study", "studies",
    "research", "project", "paper", "papers", "dataset", "datasets", "trial",
    "trials", "grant", "grants", "about", "which", "there", "their", "these",
    "those", "would", "could", "should", "based", "found", "relevant",
    "related", "results", "result", "information", "provides", "provide",
}


def _content_words(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-zA-Z][a-zA-Z0-9\-]{3,}", (text or "").lower())
        if w not in _GROUNDING_STOPWORDS
    }


def _is_grounded(rationale: str, found_vocab: set[str]) -> bool:
    """The gate itself. `found_vocab` is every content word drawn from the
    titles/summaries of what step 1/2 actually surfaced for this run."""
    lower = (rationale or "").lower()
    if any(phrase in lower for phrase in _GAP_PHRASES):
        return True
    return bool(_content_words(rationale) & found_vocab)


_CHECKLIST_SYSTEM = (
    "You are a research assistant proposing next steps for a lab project. You will "
    "be given the project's description, a short list of items that were actually "
    "found for it (papers, datasets, tools, trials, grants, etc.), and the "
    "checklist items the team already has.\n\n"
    "Propose concrete next steps and gaps, GROUNDED in what was actually found — "
    "e.g. 'no in vivo validation model identified in the literature we found' is "
    "useful, 'do more research' is not. Do not repeat or rephrase an existing "
    "checklist item.\n\n"
    f"Propose at most {MAX_CHECKLIST} items — fewer is fine.\n\n"
    'Return ONLY a JSON object: {"items": [{"label": "<short actionable label>", '
    '"rationale": "<one sentence tying it to what was found>"}, ...]}. No prose, '
    "no code fences."
)


def _try_propose_checklist_once(
    description: str, found_summary: list[dict], existing_labels: list[str], found_vocab: set[str]
) -> tuple[list[dict], int] | None:
    """One attempt at the checklist call + parse + grounding gate. Returns
    (items, dropped_ungrounded_count) on success — items may legitimately be
    [] (every proposed item got filtered, or the model itself proposed
    nothing, both real outcomes, not failures). Returns None only when the
    JSON itself couldn't be used (caller decides whether to retry). Raises on
    an actual LLM-call exception, same distinction as _try_select_relevant_once."""
    resp = llm.complete(
        [
            {"role": "system", "content": _CHECKLIST_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Project description: {description or '(none given)'}\n\n"
                    f"Found items: {json.dumps(found_summary)}\n\n"
                    f"Existing checklist items: {json.dumps(existing_labels)}\n\n"
                    'Return ONLY {"items": [{"label": "...", "rationale": "..."}]}.'
                ),
            },
        ],
        temperature=0.3,
    )
    data = _loads_lenient(resp.content)
    raw = data.get("items") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None
    existing_lower = {label.strip().lower() for label in existing_labels}
    out: list[dict] = []
    dropped = 0
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        label = entry.get("label")
        rationale = entry.get("rationale")
        if not isinstance(label, str) or not label.strip():
            continue
        if label.strip().lower() in existing_lower:
            continue
        rationale_text = rationale.strip() if isinstance(rationale, str) else ""
        # THE GATE: no citation to something actually found and no
        # named gap -> drop it, no matter how plausible it reads.
        if not _is_grounded(rationale_text, found_vocab):
            dropped += 1
            logger.warning(
                "project_agent: dropped ungrounded checklist item %r (rationale=%r)",
                label.strip(), rationale_text,
            )
            continue
        out.append({"label": label.strip()[:300], "rationale": rationale_text})
        if len(out) >= MAX_CHECKLIST:
            break
    return out, dropped


def _propose_checklist(
    description: str, selected: list[dict], existing_labels: list[str], candidates: list[dict]
) -> tuple[list[dict], bool, int]:
    """Returns (proposed checklist items, used_fallback, dropped_ungrounded_count).
    An empty result is a legitimate outcome here (nothing to add) — this only
    "falls back" (to nothing, with a note) if the call/parse itself fails,
    never to a filler item.

    `candidates` (the full step-1 pool, not just the 8 selected) backs the
    grounding gate — a valid gap item like Chen's "none of the found papers
    address X" cites the whole search, not only what survived relevance.

    RETRY: same shape as _select_relevant — malformed JSON gets ONE retry
    after a short backoff (usually a one-off bad sample); an actual
    exception from llm.complete() itself is not retried."""
    found_summary = [
        {"kind": s.get("kind"), "title": s.get("title")} for s in selected[:MAX_SELECTED]
    ]
    found_vocab: set[str] = set()
    for c in candidates:
        found_vocab |= _content_words(c.get("title"))
        found_vocab |= _content_words(c.get("summary"))

    try:
        result = _try_propose_checklist_once(description, found_summary, existing_labels, found_vocab)
        if result is not None:
            out, dropped = result
            return out, False, dropped
        logger.warning("project_agent: checklist JSON unusable (attempt 1/2), retrying once")
        time.sleep(_JSON_RETRY_BACKOFF_SEC)
        result = _try_propose_checklist_once(description, found_summary, existing_labels, found_vocab)
        if result is not None:
            logger.info("project_agent: checklist JSON usable on retry (attempt 2/2)")
            out, dropped = result
            return out, False, dropped
        logger.warning("project_agent: checklist JSON unusable (attempt 2/2)")
    except Exception:
        logger.exception("project_agent: checklist LLM call failed")
    return [], True, 0


# ── orchestration ─────────────────────────────────────────────────────────────


async def run_project_agent_async(project: dict, on_stage=None) -> dict:
    """Run the full pipeline for one project. `project` carries whatever the
    frontend sends: name, description, target, indication, modality, stage,
    existing_checklist (list of labels, so step 3 doesn't duplicate them), and
    saved_item_ids (list of item ids already saved to the project's Resources,
    so step 2 excludes them BEFORE the relevance pass — the selection budget
    goes to genuinely new items, not re-proposals of what's already there).

    `on_stage`, if given, is called (sync, best-effort) with a short stage
    name — "searching" / "judging_relevance" / "proposing_checklist" / "done" —
    right before each step starts, purely so a caller (the job-polling HTTP
    route below) can report real progress instead of a bare spinner. A
    callback failure is swallowed; it must never break the pipeline it's
    just observing. `proposing_checklist` is never reported for a ColaboFest
    project (see below) — there's no step to be "on."

    CHALLENGE PROJECTS (project["challenge_key"] set) GET RESOURCES ONLY, NO
    CHECKLIST. A ColaboFest project already comes pre-filled with SPARC's own
    nine readiness items — that checklist is SPARC's, not ours, and proposing
    six more on top of it is exactly the "overwhelming it" Chen called out
    when the agent was first gated off ColaboFest entirely. Resource
    discovery (step 1 + step 2) is pure value with no such conflict, so it's
    no longer withheld — only step 3 (checklist proposal) is skipped, and
    it's SKIPPED, not run-then-discarded: `_propose_checklist` is never
    called, so a challenge-project run makes one fewer LLM call than a
    regular one, not the same call with its output thrown away.

    Returns:
      {
        summary: str,                       # what the agent did, one paragraph
        selected_items: [Item + {reason}],  # full item shape, ready for ItemCard
        checklist_items: [{label, rationale}],  # always [] for a challenge project
        checklist_enabled: bool,            # False for a challenge project — the
                                             # frontend's cue to not render an empty
                                             # "Proposed checklist items (0)" heading;
                                             # checklist_items==[] alone can't carry
                                             # that distinction, since a regular
                                             # project can also legitimately find zero
        digest: {markdown, generated_at, counts} | None,  # the downloadable digest
                                             # (tools/prior_art_brief.py's
                                             # render_digest()) — None only when the
                                             # search itself failed entirely; NOT
                                             # gated on the relevance pass succeeding
        tools_called: [str],                # from step 1, for transparency
        warnings: [str],                    # partial-failure notes, never fatal
        analysis_failed: bool,              # relevance pass itself failed — see below
      }

    Never raises for a normal upstream failure — every step degrades on its
    own and the run still returns whatever it managed to find. The one
    exception, per Chen's review: if the RELEVANCE PASS ITSELF fails (the LLM
    call/JSON breaks, e.g. hitting a quota), this does NOT fall back to
    unranked search results with a quiet caveat — that is exactly the
    "garbage" outcome Chen called out (unranked, possibly off-topic items,
    with the caveat buried in a warnings list underneath them). Instead the
    run proposes NOTHING and sets analysis_failed=True, which the frontend
    renders as a prominent top-of-panel message instead of a review list.
    Checklist proposal is skipped entirely in that case too, since step 3
    would otherwise be "grounding" itself in an unranked, unvetted pool."""
    warnings: list[str] = []
    is_challenge = bool(project.get("challenge_key"))

    def _stage(name: str) -> None:
        if on_stage is None:
            return
        try:
            on_stage(name)
        except Exception:
            logger.exception("project_agent: on_stage callback failed for stage=%r", name)

    goal_text = _project_goal_text(project)
    goal_summary = _goal_summary(project)

    _stage("searching")
    explore_result, stopped_trials, recruiting_trials, search_failed = await _search(project, goal_text)
    if search_failed:
        warnings.append("The search step failed; no candidates were found.")

    # DIGEST — pure rendering over what was JUST collected, no LLM, no
    # network. Rendered whenever the search itself succeeded, independent of
    # whether the relevance pass below succeeds: a relevance-pass failure
    # says nothing about whether the digest (which never calls an LLM) is
    # trustworthy, so it must not be withheld because of it. `None` only
    # when explore_async itself failed — there's genuinely nothing to render.
    digest = None
    if not search_failed:
        stopped_dicts = [i.model_dump() if isinstance(i, Item) else i for i in stopped_trials]
        recruiting_dicts = [i.model_dump() if isinstance(i, Item) else i for i in recruiting_trials]
        digest = render_digest(
            project,
            goal_text=goal_text,
            sections=explore_result.get("sections") or [],
            stopped=stopped_dicts,
            recruiting=recruiting_dicts,
        )

    excluded_ids = {
        str(item_id).strip() for item_id in (project.get("saved_item_ids") or []) if str(item_id).strip()
    }
    candidates, failed_tools, excluded_count = _flatten_candidates(explore_result, excluded_ids)
    if failed_tools:
        warnings.append(f"These sources didn't return results: {', '.join(failed_tools)}.")

    _stage("judging_relevance")
    selected, relevance_fallback = _select_relevant(goal_summary, candidates)

    # FAIL CLOSED: the relevance pass failing is not a "degrade gracefully"
    # case like an empty source — it means nothing was actually judged
    # against this project's goal, so nothing here is trustworthy enough to
    # propose. Discard whatever _select_relevant's own fallback produced
    # (unranked top candidates) rather than showing them.
    if relevance_fallback:
        _stage("done")
        return {
            "summary": (
                f"Searched {len(explore_result.get('tools_called') or [])} sources for "
                f"“{goal_summary}”, but couldn't complete the relevance analysis."
            ),
            "selected_items": [],
            "checklist_items": [],
            "checklist_enabled": not is_challenge,
            "digest": digest,  # still rendered — it never called an LLM, so the
                                # relevance pass failing doesn't make it untrustworthy
            "tools_called": explore_result.get("tools_called") or [],
            "warnings": [
                "The agent could not complete its analysis this run — the relevance pass "
                "failed, so nothing is being proposed rather than showing unranked, "
                "unvetted results. Try again in a moment."
            ],
            "analysis_failed": True,
        }

    checklist_items: list[dict] = []
    if is_challenge:
        # SKIPPED, not filtered — _propose_checklist (and its LLM call) is
        # never invoked for a challenge project. See this function's own
        # docstring for why.
        dropped_ungrounded = 0
    else:
        existing_labels = [
            str(label).strip() for label in (project.get("existing_checklist") or []) if str(label).strip()
        ]
        _stage("proposing_checklist")
        checklist_items, checklist_fallback, dropped_ungrounded = _propose_checklist(
            project.get("description") or "", selected, existing_labels, candidates
        )
        if checklist_fallback:
            warnings.append("Couldn't generate checklist suggestions this run.")
    if dropped_ungrounded:
        warnings.append(
            f"Dropped {dropped_ungrounded} proposed checklist item(s) that weren't grounded in "
            "anything this run actually found."
        )
    _stage("done")

    # Honest reporting when exclusion is *why* there's nothing to propose —
    # a team that already saved everything relevant should hear "nothing new
    # found beyond what's already saved", not a generic "no results" that
    # reads like the search itself came up empty.
    nothing_new_due_to_exclusion = not selected and excluded_count > 0 and not candidates

    # For a challenge project there IS no checklist step, so "nothing to
    # propose" must be judged on `selected` alone — checklist_items is
    # always [] there regardless of whether the run found anything.
    nothing_proposed = not selected if is_challenge else not selected and not checklist_items

    if nothing_proposed:
        if nothing_new_due_to_exclusion:
            warnings.append(
                "Nothing new found beyond what's already saved to this project — every "
                "candidate the search turned up is already in Resources."
            )
        elif is_challenge:
            warnings.append(
                "No relevant resources were found for this project's stated goal — try "
                "adding more detail to the description, or check back after the underlying "
                "sources recover."
            )
        else:
            warnings.append(
                "No relevant resources or checklist suggestions were found for this project's "
                "stated goal — try adding more detail to the description, or check back after "
                "the underlying sources recover."
            )

    summary_bits = [f"Searched {len(explore_result.get('tools_called') or [])} sources for “{goal_summary}”."]
    if digest:
        summary_bits.append("Produced a prior-art digest.")
    if excluded_count:
        summary_bits.append(
            f"Skipped {excluded_count} already-saved item(s) so the selection budget went to "
            "genuinely new candidates."
        )
    if selected:
        summary_bits.append(f"Selected {len(selected)} relevant item(s) to propose saving.")
    # checklist_items is always [] on a challenge project — never mention
    # checklist items in the summary there, not even "proposed 0."
    if checklist_items:
        summary_bits.append(f"Proposed {len(checklist_items)} checklist item(s).")
    if nothing_proposed:
        summary_bits.append(
            "Nothing new found beyond what's already saved this run."
            if nothing_new_due_to_exclusion
            else "Found nothing to propose this run."
        )

    return {
        "summary": " ".join(summary_bits),
        "selected_items": selected,
        "checklist_items": checklist_items,
        "checklist_enabled": not is_challenge,
        "digest": digest,  # {markdown, generated_at, counts} or None if the search failed entirely
        "tools_called": explore_result.get("tools_called") or [],
        "warnings": warnings,
        "analysis_failed": False,
    }
