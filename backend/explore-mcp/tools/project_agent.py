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
from tools.wiki_agent import build_wiki_notes, file_evidence, split_unfiled, suggest_missing_notes

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
    explore_result: dict, excluded_ids: set[str], max_candidates: int = 0
) -> tuple[list[dict], list[str], int, int]:
    """All items across every section, deduped by id, round-robinned ACROSS
    sections (one item from every section, then a second from every section
    that still has one, and so on) up to `max_candidates`, with anything
    already saved to the project (`excluded_ids`) dropped BEFORE the
    relevance pass even sees it — so the LLM's limited selection budget goes
    on genuinely new items, not on re-proposing what's already there. Kinds
    in `_AGENT_EXCLUDED_KINDS` (currently just episodes) are dropped the same
    way, before excluded_ids or the round-robin ever see them.

    WHY ROUND-ROBIN, NOT A FLAT `items[:max_candidates]` OVER SECTIONS
    CONCATENATED IN TOOL ORDER: tool order (`_TOOL_DESCRIPTIONS` in
    tools/explore.py) puts search_datasets/search_pager near the END of the
    list. A flat slice fills up on whatever ran first — papers, news,
    trials, grants, tools can already total 50 items before datasets/pager
    are ever appended — so on a real run those two sections were 10/10 in
    the digest (which renders straight from `sections`, uncapped) and 0/0 in
    the candidate pool the relevance prompt actually saw. Same disease as
    tools/search_papers.py's own round-robin fix for one sub-query
    dominating a shared cap (see that module's ROUND-ROBIN note); this is
    the same shape, keyed on section kind instead of a sub-query cursor.

    Returns (items, failed_tool_names, excluded_count, total_found) —
    total_found is len(seen): every DISTINCT non-episode item across every
    section, BEFORE the excluded_ids drop and before the max_candidates cap
    — the true "how many did the search actually turn up" number. This is
    what backs "Showing 8 of 47 found" on the frontend (see AgentSection.tsx
    and this function's caller below): selected_items is capped at
    MAX_SELECTED(=8) by design, and total_found is what a researcher would
    see if they went to Explore for this project instead — reported
    honestly rather than left implicit in a sources table that only shows
    per-kind counts. excluded_count is reported separately (as before) so
    the summary can say how much of what was found was already saved,
    rather than silently shrinking the candidate pool. `max_candidates <= 0`
    means unbounded (round-robins every item, useful for tests that don't
    care about the cap)."""
    seen: set[str] = set()
    failed: list[str] = []
    excluded_count = 0

    # Pass 1 — per-section filtered/deduped item lists, section order
    # preserved (it becomes the round-robin's own column order below), but
    # nothing here decides how many of each kind make the final cut.
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
            if item_id in excluded_ids:
                excluded_count += 1
                continue
            bucket.append(item)
        if bucket:
            per_section.append(bucket)

    # Pass 2 — round-robin: one item from every section with anything left,
    # repeat, until every section is exhausted or the cap is hit.
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

    return items, failed, excluded_count, len(seen)


# ── step 2: relevance pass (MAP-REDUCE, batched) ──────────────────────────────
#
# WHY BATCHED: a single call listing every candidate keeps growing every time
# a source is added — confirmed the hard way (2026-08-23): adding ChEMBL and
# Open Targets pushed this prompt over Groq's 8000 TPM limit on every run.
# Measured directly, not assumed: the single-call prompt for the NLRP3
# project was 8298 tokens (56 candidates: system 285 + user 8013). Excluding
# ChEMBL and Open Targets entirely only brought it to 7929 — STILL against
# the ceiling. The actual dominant cost was GEO dataset summaries (313.7
# tokens/item average, 3137 of the 8013 candidate tokens from just 10 items)
# and PAGER gene sets (171.6/item), both already in the pipeline before
# today; ChEMBL contributed 0 items that run (no ChEMBL records exist for
# this target) and Open Targets contributed 369 tokens. The real problem:
# this prompt was already within ~70 tokens of the ceiling for reasons
# unrelated to either new source, so ANY addition — a new source, one
# longer GEO abstract landing in the top 10 — was going to tip it over
# eventually. A single call was never going to stay under budget as sources
# keep getting added; only batching is a structural fix.
#
# TWO STAGES:
#   MAP    — candidates are packed into fixed-TOKEN-BUDGET batches, not a
#            flat item count (a batch of 15 papers and a batch of 15 GEO
#            datasets are wildly different sizes per the measurement above,
#            so packing by estimated tokens is what actually keeps every
#            batch under budget regardless of which kinds land in it). Each
#            batch is scored independently on a 0-10 rubric (not a bare
#            yes/no) — the rubric's fixed anchors are what keep scores AT
#            LEAST roughly comparable across independent calls that never
#            see each other's candidates; a bare "is this relevant" judgment
#            has no shared reference point call to call.
#   REDUCE — the highest-scoring survivors across ALL batches, packed into
#            ANOTHER fixed token budget (so REDUCE's own prompt size is
#            constant regardless of how many total candidates or sources
#            exist — the other half of the structural fix: MAP absorbs
#            unbounded growth into more, still-small, batches; REDUCE always
#            sees the same bounded pool), go through ONE MORE relevance
#            call — the ORIGINAL single-call prompt, unchanged, full
#            cross-item visibility, the real _apply_kind_cap diversity logic
#            and MAX_SELECTED cutoff exactly as before today.
#
# HOW RANKING STAYS CONSISTENT ACROSS BATCHES, AND WHERE IT CAN'T: MAP's
# scores decide who gets a SEAT in the final round, never the final ranking
# itself — the actual `selected` decision still comes from REDUCE's own
# holistic judgment over everything that made it in. This means calibration
# drift between independently-run MAP batches (a "9/10" in one batch is not
# guaranteed to mean the same thing as a "9/10" in another — there is no way
# to make batches that never see each other perfectly comparable) can only
# cost a strong candidate ITS SEAT, never let a weak one WIN a seat it then
# loses anyway. The REDUCE token budget is set well above what MAX_SELECTED
# (=8) needs specifically to absorb ordinary cross-batch scoring noise
# without losing genuinely strong candidates to it. THIS IS A REAL, NAMED
# TRADE-OFF, not a free fix: the old single call had perfect cross-item
# visibility over the whole pool; batching trades some of that recall for a
# hard token ceiling that no longer grows with the number of sources. If a
# run's selection quality visibly degrades, the first things to check are
# _REDUCE_TOKEN_BUDGET (raise it) and _MAP_SYSTEM's rubric (sharpen it) —
# not reverting to one call, which is exactly what broke on 2026-08-23.

_CHARS_PER_TOKEN_ESTIMATE = 3.5   # conservative: measured 3.94 chars/token for
                                  # this JSON shape. Estimating from chars, not
                                  # adding a tokenizer dependency, matches
                                  # podcast-agent/extract.py's own _MAX_CHARS
                                  # convention. Using 3.5, not the measured
                                  # 3.94, means this OVER-estimates token count
                                  # (fewer chars needed to hit a budget) —
                                  # erring toward smaller batches, never toward
                                  # underestimating and blowing through one.
_MAP_BATCH_TOKEN_BUDGET = 3500    # a batch this size, all-GEO-dataset (the
                                  # heaviest kind measured, ~314 tokens/item),
                                  # is ~11 items; a batch of all-paper/trial/
                                  # grant (~75-107 tokens/item) is 30+ items.
                                  # Either way, system prompt (~320 tokens) +
                                  # this budget stays under half of Groq's
                                  # free-tier 8000 TPM ceiling, with real
                                  # headroom for reasoning tokens and further
                                  # growth in any one kind's verbosity.
_MAP_SCORE_MIN_TO_ADVANCE = 5     # 0-10 rubric (see _MAP_SYSTEM) — below the
                                  # midpoint is "tangential at best," not
                                  # worth a seat in the bounded reduce pool.
_REDUCE_TOKEN_BUDGET = 5000       # bounds REDUCE's OWN prompt size directly by
                                  # tokens, not item count, so a survivor pool
                                  # that happens to be mostly GEO-dataset-heavy
                                  # still can't blow the ceiling. system (~285)
                                  # + this budget leaves ~2700 tokens of
                                  # headroom under 8000 for reasoning tokens.

_MAP_SYSTEM = (
    "You are screening ONE BATCH of candidate items (papers, datasets, gene "
    "sets, trials, grants, tools, etc.) found by searching for a lab "
    "project's stated GOAL. You are NOT seeing the project's other "
    "candidates from other batches — do not assume this batch is complete "
    "or representative of everything found.\n\n"
    "Score EVERY item in this batch 0-10 for how relevant it is to the GOAL "
    "specifically (not just topical keyword overlap):\n"
    "  0-2  — unrelated, or shares a keyword only by coincidence\n"
    "  3-5  — topically related but tangential to what the team is actually "
    "trying to resolve\n"
    "  6-8  — directly relevant to the goal\n"
    "  9-10 — directly relevant AND names a specific mechanism, compound, "
    "cohort, or dataset the goal explicitly asks about\n\n"
    "For every item scored 5 or above, write ONE SHORT SENTENCE explaining "
    "why, tied to the goal. Do not include items scored below 5 at all.\n\n"
    'Return ONLY a JSON object: {"scored": [{"id": "<item id>", "score": '
    '<0-10>, "reason": "<one sentence>"}, ...]}. Use the exact `id` field '
    "from the candidate list. No prose, no code fences."
)

# This is now the REDUCE-stage prompt (see the module docstring above) —
# unchanged from before batching existed. It runs over the bounded,
# pre-scored survivor pool _select_relevant assembles below, with full
# cross-item visibility, and is where the actual `selected` decision and
# diversity cap (_apply_kind_cap) still happen, exactly as before today.
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
    "PREFER A DIVERSE SELECTION when multiple kinds of candidate are genuinely "
    "relevant — a paper, a dataset, a gene set and a tool that are each relevant "
    "beat five relevant papers and nothing else. Do not let one kind (papers, "
    "most often) fill every slot just because that kind happens to have the most "
    "candidates; a candidate list dominated by papers is a fact about how the "
    "search works, not a sign that only papers are worth proposing.\n\n"
    f"Select at most {MAX_SELECTED} items — fewer is fine if fewer are genuinely "
    "relevant. Never select an item just to fill the quota.\n\n"
    'Return ONLY a JSON object: {"selected": [{"id": "<item id>", "reason": '
    '"<one sentence>"}, ...]}. Use the exact `id` field from the candidate list. '
    "No prose, no code fences."
)

# THE GATE (same prompt-asks-code-enforces pattern as the checklist's
# grounding gate, _classify_grounding below — a prompt instruction is not
# a guarantee, so diversity is enforced here too, not just asked for above).
# At most 3 papers, at most 2 of any other single kind, within MAX_SELECTED
# (=8) slots. Papers get a wider allowance because they are legitimately the
# largest and most reliable candidate pool most runs; other kinds get a
# smaller allowance so 2-3 crowd out one kind entirely.
#
# MUST NOT CREATE EMPTY SLOTS: this cap only ever applies when at least one
# OTHER kind is present in the candidates the LLM was shown — see
# _apply_kind_cap's own docstring for the two-pass backfill that guarantees
# a single-kind candidate pool (e.g. only papers came back) still fills all
# MAX_SELECTED slots with that one kind, uncapped.
_PAPER_KIND = "paper"
_MAX_PER_KIND = {_PAPER_KIND: 3}
_MAX_PER_OTHER_KIND = 2


def _apply_kind_cap(ranked: list[dict]) -> list[dict]:
    """`ranked` is the LLM's own selection, already in its preferred order.
    Enforces the per-kind cap ONLY when more than one kind is present in
    `ranked` — a single-kind list (e.g. only papers were ever relevant, or
    only papers were ever found) passes through untouched, so the cap can
    never shrink a genuinely single-kind result below MAX_SELECTED.

    Two passes: first take items respecting the cap (preserving rank order),
    then BACKFILL any still-empty slots from whatever was skipped for
    exceeding its cap (also in rank order) — this is what keeps a mixed pool
    that only had, say, 3 papers + 2 datasets + 2 tools (7 total, nothing
    else available) from being artificially thinned to fewer than the LLM
    actually offered; the 8th slot backfills from the next-ranked skipped
    item rather than being left empty."""
    kinds_present = {item.get("kind") for item in ranked}
    if len(kinds_present) <= 1:
        return ranked[:MAX_SELECTED]

    kept: list[dict] = []
    skipped: list[dict] = []
    counts: dict[str, int] = {}
    for item in ranked:
        kind = item.get("kind")
        cap = _MAX_PER_KIND.get(kind, _MAX_PER_OTHER_KIND)
        if counts.get(kind, 0) < cap and len(kept) < MAX_SELECTED:
            kept.append(item)
            counts[kind] = counts.get(kind, 0) + 1
        else:
            skipped.append(item)

    if len(kept) < MAX_SELECTED:
        for item in skipped:
            if len(kept) >= MAX_SELECTED:
                break
            kept.append(item)

    return kept


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
    # No MAX_SELECTED cutoff in this loop — _apply_kind_cap below needs the
    # model's FULL ranked list (still capped implicitly by the model's own
    # instruction to select at most MAX_SELECTED, but not truncated further
    # here) to decide what to keep vs. backfill from.
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
    out = _apply_kind_cap(out)
    return out or None


def _estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / _CHARS_PER_TOKEN_ESTIMATE))


def _batch_by_token_budget(trimmed: list[dict], token_budget: int) -> list[list[dict]]:
    """Greedily packs candidate summaries into batches that each stay under
    `token_budget` (estimated, see _estimate_tokens) — by TOKENS, not a flat
    item count, since kinds vary 4x+ in verbosity (GEO datasets ~314
    tokens/item vs. Open Targets ~62, measured directly — see this
    section's own module docstring). A single item that alone exceeds the
    budget still gets its own one-item batch rather than being dropped —
    that batch's own call may run over budget in a genuinely pathological
    case, but that is one oversized item away from the ceiling, not the
    entire candidate pool away from it, and is a visible input to fix
    (report it, don't silently drop it)."""
    batches: list[list[dict]] = []
    current: list[dict] = []
    current_tokens = 0
    for item in trimmed:
        item_tokens = _estimate_tokens(json.dumps(item))
        if current and current_tokens + item_tokens > token_budget:
            batches.append(current)
            current = []
            current_tokens = 0
        current.append(item)
        current_tokens += item_tokens
    if current:
        batches.append(current)
    return batches


def _try_map_batch_once(goal_summary: str, batch: list[dict], by_id: dict[str, dict]) -> list[dict] | None:
    """One attempt at scoring one MAP batch. Returns [{**item, _map_score,
    reason}] for every item scored >= _MAP_SCORE_MIN_TO_ADVANCE — an empty
    list is a legitimate "nothing in this batch cleared the bar" outcome,
    not unusable JSON. Returns None only when the JSON itself couldn't be
    parsed (caller decides whether to retry). Raises on an actual LLM-call
    exception, same distinction as the reduce stage below."""
    resp = llm.complete(
        [
            {"role": "system", "content": _MAP_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"GOAL: {goal_summary}\n\n"
                    f"Candidate items (this batch only):\n{json.dumps(batch)}\n\n"
                    'Return ONLY {"scored": [{"id": "...", "score": 0, "reason": "..."}]}.'
                ),
            },
        ],
        temperature=0.2,
    )
    data = _loads_lenient(resp.content)
    raw = data.get("scored") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None
    out: list[dict] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        item_id = entry.get("id")
        score = entry.get("score")
        reason = entry.get("reason")
        if not isinstance(item_id, str) or item_id not in by_id or item_id in seen:
            continue
        if not isinstance(score, (int, float)) or score < _MAP_SCORE_MIN_TO_ADVANCE:
            continue
        if not isinstance(reason, str) or not reason.strip():
            continue
        seen.add(item_id)
        out.append({**by_id[item_id], "_map_score": float(score), "reason": reason.strip()})
    return out


def _map_batch(goal_summary: str, batch: list[dict], by_id: dict[str, dict], batch_label: str) -> list[dict]:
    """One batch's full attempt, including the standard one-retry-on-bad-
    JSON policy. A batch that fails outright (bad JSON twice, or a real
    LLM-call exception) contributes NOTHING to the survivor pool and logs a
    warning NAMING which batch — it does not fail the whole run. REDUCE
    still runs over whatever the OTHER batches produced; only if every
    batch fails does the pool end up empty, which is handled the same way
    as "no candidates found" always has been."""
    try:
        out = _try_map_batch_once(goal_summary, batch, by_id)
        if out is not None:
            return out
        logger.warning("project_agent: map batch %s JSON unusable (attempt 1/2), retrying once", batch_label)
        time.sleep(_JSON_RETRY_BACKOFF_SEC)
        out = _try_map_batch_once(goal_summary, batch, by_id)
        if out is not None:
            return out
        logger.warning(
            "project_agent: map batch %s JSON unusable (attempt 2/2) — this batch contributes nothing",
            batch_label,
        )
    except Exception:
        logger.exception(
            "project_agent: map batch %s LLM call failed — this batch contributes nothing", batch_label
        )
    return []


def _select_relevant(goal_summary: str, candidates: list[dict]) -> tuple[list[dict], bool]:
    """Returns (selected item dicts each carrying `reason`, used_fallback).

    `used_fallback=True` means the run could NOT complete a trustworthy
    relevance judgment at all — the caller (run_project_agent_async) fails
    CLOSED on this: `selected` is always `[]` in that case, and the caller
    discards it and proposes nothing rather than showing anything unranked.
    NOTHING here builds an "unranked top-N" list to hand back on failure any
    more — that used to exist, and its own log line ("falling back to top
    candidates") was actively misleading, since the caller always discarded
    that list and proposed nothing regardless. A log describing behavior
    the code doesn't actually have cost real time to debug mid-incident on
    2026-08-23 — fixed here by describing what actually happens (nothing is
    proposed), not by re-wording around the same gap.

    See this section's own module docstring for the MAP-REDUCE design this
    runs (batches candidates by token budget, scores each batch
    independently, reduces the highest-scoring survivors through one final
    holistic call) and why it exists."""
    if not candidates:
        return [], False

    by_id = {c["id"]: c for c in candidates}
    trimmed = [_candidate_summary(c) for c in candidates[:MAX_CANDIDATES]]

    batches = _batch_by_token_budget(trimmed, _MAP_BATCH_TOKEN_BUDGET)
    survivors: list[dict] = []
    for i, batch in enumerate(batches):
        survivors.extend(_map_batch(goal_summary, batch, by_id, batch_label=f"{i + 1}/{len(batches)}"))

    if not survivors:
        logger.warning(
            "project_agent: no candidate scored >= %s across %d map batch(es) — nothing to propose this run",
            _MAP_SCORE_MIN_TO_ADVANCE, len(batches),
        )
        return [], True

    # REDUCE input: highest-scoring survivors first, packed into ANOTHER
    # fixed token budget (not a flat item count — same reasoning as the MAP
    # batches themselves) so this stage's prompt size is constant regardless
    # of how many total candidates or sources exist.
    survivors.sort(key=lambda s: s["_map_score"], reverse=True)
    reduce_ids: list[str] = []
    reduce_tokens = 0
    seen_ids: set[str] = set()
    for s in survivors:
        item_id = s["id"]
        if item_id in seen_ids:
            continue
        item_tokens = _estimate_tokens(json.dumps(_candidate_summary(by_id[item_id])))
        if reduce_ids and reduce_tokens + item_tokens > _REDUCE_TOKEN_BUDGET:
            break
        seen_ids.add(item_id)
        reduce_ids.append(item_id)
        reduce_tokens += item_tokens

    reduce_by_id = {item_id: by_id[item_id] for item_id in reduce_ids}
    reduce_trimmed = [_candidate_summary(reduce_by_id[item_id]) for item_id in reduce_ids]

    try:
        out = _try_select_relevant_once(goal_summary, reduce_trimmed, reduce_by_id)
        if out is not None:
            return out, False
        logger.warning("project_agent: reduce-stage relevance JSON unusable (attempt 1/2), retrying once")
        time.sleep(_JSON_RETRY_BACKOFF_SEC)
        out = _try_select_relevant_once(goal_summary, reduce_trimmed, reduce_by_id)
        if out is not None:
            logger.info("project_agent: reduce-stage relevance JSON usable on retry (attempt 2/2)")
            return out, False
        logger.warning(
            "project_agent: reduce-stage relevance JSON unusable after retry — nothing will be proposed this run"
        )
    except Exception:
        logger.exception(
            "project_agent: reduce-stage relevance LLM call failed — nothing will be proposed this run"
        )

    return [], True


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


# CAP ON "ANALYSE THE DATA WE JUST FOUND" ITEMS — same prompt-asks-code-
# enforces pattern as the grounding gate itself. Real failure, NLRP3
# project: of 13 proposed items, most were variations on "analyse/
# integrate/screen the dataset we just found" — the agent proposing work
# on its own search results (a real citation, so the grounding gate above
# passed every one of them) rather than work the PROJECT needs. A prompt
# instruction alone doesn't hold under load, same lesson as
# _classify_grounding's own docstring — this caps how many surviving items may be grounded
# ONLY in a dataset/gene-set candidate (as opposed to a genuine gap
# statement, or grounded in a paper/trial/tool/grant, which is real
# synthesis, not "look at this dataset"). Anything past the cap is
# dropped, in the model's own rank order, freeing that slot for whatever
# comes next rather than silently shrinking the proposal.
_MAX_DATA_ANALYSIS_ITEMS = 2

# Kinds whose vocabulary counts as "just a dataset/gene set we found",
# never enough on its own to justify a checklist item under the cap above.
_DATA_KINDS = {"dataset", "geneset"}


def _split_vocab_by_kind(candidates: list[dict]) -> tuple[set[str], set[str]]:
    """found_vocab, split into (dataset_vocab, other_vocab). dataset_vocab
    is every content word from a dataset/geneset candidate's title/summary;
    other_vocab is every content word from every OTHER kind (paper, tool,
    trial, grant, resource, person, episode). Lets the gate below tell
    "grounded in a dataset we found" apart from "grounded in a paper/
    trial/tool/grant we found" — only the former is subject to the cap."""
    dataset_vocab: set[str] = set()
    other_vocab: set[str] = set()
    for c in candidates:
        words = _content_words(c.get("title")) | _content_words(c.get("summary"))
        if c.get("kind") in _DATA_KINDS:
            dataset_vocab |= words
        else:
            other_vocab |= words
    return dataset_vocab, other_vocab


def _classify_grounding(rationale: str, dataset_vocab: set[str], other_vocab: set[str]) -> str:
    """The gate itself, extended to classify HOW an item is grounded, not
    just whether it is:
      "gap"          — names an explicit gap (a _GAP_PHRASES match). Always
                       kept, never subject to the data-analysis cap — these
                       are the strongest items this pipeline produces.
      "other"        — cites real vocabulary from a paper/trial/tool/grant
                       candidate. Real synthesis grounded in something
                       besides a bare dataset; never capped either.
      "dataset_only" — cites vocabulary ONLY from a dataset/geneset
                       candidate, nothing else. This is exactly "analyse/
                       integrate/screen the dataset we just found" —
                       subject to _MAX_DATA_ANALYSIS_ITEMS.
      "ungrounded"   — cites nothing real. Dropped unconditionally, as
                       before."""
    lower = (rationale or "").lower()
    if any(phrase in lower for phrase in _GAP_PHRASES):
        return "gap"
    words = _content_words(rationale)
    if words & other_vocab:
        return "other"
    if words & dataset_vocab:
        return "dataset_only"
    return "ungrounded"


_CHECKLIST_SYSTEM = (
    "You are a research assistant proposing next steps for a lab project. You will "
    "be given the project's description, a short list of items that were actually "
    "found for it (papers, datasets, tools, trials, grants, etc. — each described by "
    "its KIND and TITLE, not material the team already possesses), and the checklist "
    "items the team already has.\n\n"
    "NEVER quote a found item's title as if it names a study, cohort, or resource the "
    "team can go and use. A GEO dataset's title is a description written by whoever "
    "deposited it — it is not a named study or cohort the team has access to. Refer "
    "to what the item IS, in your own words, never its title in quotes: write "
    '"a published scRNA-seq dataset of diabetic kidney biopsies", never \'the '
    "\\\"Tubular epithelial cells promote macrophage pyroptosis\\\" dataset'. Do not "
    "put quotation marks around a found item's title anywhere in a label or "
    "rationale.\n\n"
    "Propose steps the PROJECT needs — grounded in what was found, but not merely "
    "'analyse this dataset' or 'integrate this result'. The strongest items are GAP "
    "statements: something the search did NOT find that the project needs in order to "
    "proceed — e.g. 'No found paper links PANX1-P2X7 signaling to GSDMD-mediated "
    "pyroptosis in kidney tissue, which this project needs to establish.' Prefer a gap "
    "statement over a to-do about a found item whenever the found items support one.\n\n"
    f"AT MOST {_MAX_DATA_ANALYSIS_ITEMS} of your proposed items may be about "
    "analysing, integrating, or screening a dataset or gene set the search found — if "
    "half the checklist is 'look at this dataset', the proposal is thin. Spend the "
    "rest of your budget on gap statements and on steps grounded in papers, trials, "
    "tools, or grants.\n\n"
    "Do not repeat or rephrase an existing checklist item.\n\n"
    f"Propose at most {MAX_CHECKLIST} items — fewer is fine.\n\n"
    'Return ONLY a JSON object: {"items": [{"label": "<short actionable label>", '
    '"rationale": "<one sentence tying it to what was found>"}, ...]}. No prose, '
    "no code fences."
)


def _try_propose_checklist_once(
    description: str,
    found_summary: list[dict],
    existing_labels: list[str],
    dataset_vocab: set[str],
    other_vocab: set[str],
) -> tuple[list[dict], int] | None:
    """One attempt at the checklist call + parse + grounding gate + the
    data-analysis cap. Returns (items, dropped_count) on success — items may
    legitimately be [] (every proposed item got filtered, or the model
    itself proposed nothing, both real outcomes, not failures). `dropped`
    counts BOTH ungrounded drops and cap-exceeded drops (see the per-item
    logging below for which is which). Returns None only when the JSON
    itself couldn't be used (caller decides whether to retry). Raises on an
    actual LLM-call exception, same distinction as _try_select_relevant_once."""
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
    data_analysis_count = 0
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

        # THE GATE: no citation to something actually found and no named
        # gap -> drop it, no matter how plausible it reads.
        kind = _classify_grounding(rationale_text, dataset_vocab, other_vocab)
        if kind == "ungrounded":
            dropped += 1
            logger.warning(
                "project_agent: dropped ungrounded checklist item %r (rationale=%r)",
                label.strip(), rationale_text,
            )
            continue

        # THE CAP: "grounded ONLY in a dataset/geneset we found" is exactly
        # "analyse the data we just found" — real per the gate above, but
        # capped at _MAX_DATA_ANALYSIS_ITEMS so it can't crowd out gap
        # statements and paper/trial/tool/grant-grounded items the way it
        # did on the NLRP3 project (most of 13 proposed items were this
        # shape). Dropped in the model's own rank order once the cap is
        # hit — not retried, not backfilled from elsewhere; the model just
        # gets fewer of this one kind of slot.
        if kind == "dataset_only":
            if data_analysis_count >= _MAX_DATA_ANALYSIS_ITEMS:
                dropped += 1
                logger.info(
                    "project_agent: dropped checklist item %r past the "
                    "data-analysis cap (%d already kept)",
                    label.strip(), data_analysis_count,
                )
                continue
            data_analysis_count += 1

        out.append({"label": label.strip()[:300], "rationale": rationale_text})
        if len(out) >= MAX_CHECKLIST:
            break
    return out, dropped


def _propose_checklist(
    description: str, selected: list[dict], existing_labels: list[str], candidates: list[dict]
) -> tuple[list[dict], bool, int]:
    """Returns (proposed checklist items, used_fallback, dropped_count).
    An empty result is a legitimate outcome here (nothing to add) — this only
    "falls back" (to nothing, with a note) if the call/parse itself fails,
    never to a filler item.

    `candidates` (the full step-1 pool, not just the 8 selected) backs the
    grounding gate AND the data-analysis cap — a valid gap item like Chen's
    "none of the found papers address X" cites the whole search, not only
    what survived relevance, and the cap needs to tell a dataset/geneset
    candidate apart from every other kind across that same full pool.

    RETRY: same shape as _select_relevant — malformed JSON gets ONE retry
    after a short backoff (usually a one-off bad sample); an actual
    exception from llm.complete() itself is not retried."""
    found_summary = [
        {"kind": s.get("kind"), "title": s.get("title")} for s in selected[:MAX_SELECTED]
    ]
    dataset_vocab, other_vocab = _split_vocab_by_kind(candidates)

    try:
        result = _try_propose_checklist_once(
            description, found_summary, existing_labels, dataset_vocab, other_vocab
        )
        if result is not None:
            out, dropped = result
            return out, False, dropped
        logger.warning("project_agent: checklist JSON unusable (attempt 1/2), retrying once")
        time.sleep(_JSON_RETRY_BACKOFF_SEC)
        result = _try_propose_checklist_once(
            description, found_summary, existing_labels, dataset_vocab, other_vocab
        )
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
        wiki_notes: [{action, note_id, slug, title, note_type, body}],  # proposed
                                             # project-wiki writes (tools/wiki_agent.py) —
                                             # persisted server-side by
                                             # frontend/lib/server/wikiNotes.ts, same
                                             # "it proposes; the frontend persists" split
                                             # as everything else here
        evidence_filings: {slug: [{item, shared_terms}]},  # every candidate filed
                                             # under a note (tools/wiki_agent.py's
                                             # file_evidence()), keyed by the note's
                                             # slug, not a database id — see that
                                             # function's own docstring for why
        unfiled_items: [item],              # every candidate that matched no note AND
                                             # isn't a grant/trial — a genuine "maybe a
                                             # note is missing" signal. Never dropped,
                                             # stored against the project with no note
                                             # (see 2026-08-24_wiki_evidence.sql)
        project_level_items: [item],        # every candidate that matched no note BUT
                                             # is a grant or trial — evidence for the
                                             # PROJECT, not a concept; see
                                             # split_unfiled's own docstring for why
                                             # this is a display distinction, not a
                                             # storage one (same project_evidence_items
                                             # row shape as unfiled_items)
        missing_note_suggestions: [{term, count, item_ids}],  # computed over
                                             # unfiled_items ONLY (never
                                             # project_level_items — grant/trial
                                             # boilerplate vocabulary isn't a missing-
                                             # note signal) — only when unfiled items
                                             # share a recurring term, see suggest_
                                             # missing_notes' own docstring for why
                                             # this is not a clustering system
        checklist_enabled: bool,            # False for a challenge project — the
                                             # frontend's cue to not render an empty
                                             # "Proposed checklist items (0)" heading;
                                             # checklist_items==[] alone can't carry
                                             # that distinction, since a regular
                                             # project can also legitimately find zero
        digest: {markdown, generated_at, counts, goal_text} | None,  # the downloadable digest
                                             # (tools/prior_art_brief.py's
                                             # render_digest()) — None only when the
                                             # search itself failed entirely; NOT
                                             # gated on the relevance pass succeeding
        candidates_found: int,              # every DISTINCT item the search actually
                                             # turned up (see _flatten_candidates'
                                             # total_found), BEFORE the already-saved
                                             # exclusion and before the MAX_CANDIDATES
                                             # cap — selected_items is capped at
                                             # MAX_SELECTED(=8) by design, this is what
                                             # backs "Showing 8 of 47 found" on the
                                             # frontend instead of leaving the rest
                                             # implicit
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
    candidates, failed_tools, excluded_count, candidates_found = _flatten_candidates(
        explore_result, excluded_ids, max_candidates=MAX_CANDIDATES
    )
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
            "wiki_notes": [],
            "evidence_filings": {},
            "unfiled_items": [],
            "project_level_items": [],
            "missing_note_suggestions": [],
            "digest": digest,  # still rendered — it never called an LLM, so the
                                # relevance pass failing doesn't make it untrustworthy
            "candidates_found": candidates_found,
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
        # The count covers two distinct drop reasons (see _try_propose_
        # checklist_once) — ungrounded (cited nothing real) and over-cap
        # (a valid dataset/geneset-grounded item past
        # _MAX_DATA_ANALYSIS_ITEMS). Worded to cover both honestly rather
        # than implying every dropped item was groundless.
        warnings.append(
            f"Dropped {dropped_ungrounded} proposed checklist item(s) that weren't grounded in "
            "anything this run actually found, or were about analysing already-found data beyond "
            "this run's cap on that kind of item."
        )

    # WIKI NOTES — runs for every project, challenge or not (see
    # tools/wiki_agent.py). `existing_wiki_notes` is read by the frontend
    # BEFORE this run starts (frontend/lib/server/wikiNotes.ts's
    # listWikiNoteSummaries, same "server reads the caller's own data,
    # never trusts the request body" stance as existing_checklist and
    # saved_item_ids above) and forwarded on `project`. Skipped, not run-
    # then-discarded, when the search itself found nothing — an empty
    # candidate/selected/checklist pool has nothing for a note to cite.
    _stage("writing_notes")
    existing_notes = project.get("existing_wiki_notes") or []
    wiki_notes, wiki_fallback, dropped_notes = build_wiki_notes(
        goal_summary, candidates, selected, checklist_items, existing_notes
    )
    if wiki_fallback:
        warnings.append("Couldn't update the project wiki this run.")
    if dropped_notes:
        warnings.append(
            f"Dropped {dropped_notes} proposed wiki note(s) that weren't grounded in anything "
            "this run actually found."
        )

    # EVIDENCE FILING (stage 2) — every retrieved candidate, not just the
    # 5-8 selected/proposed, gets a shot at being filed under a note. Filed
    # against the notes as they'll look AFTER this run's create/update
    # proposals land (existing_notes with this run's wiki_notes proposals
    # folded on top by slug) so a note created THIS run can still receive
    # evidence in the same run — see file_evidence's own docstring for why
    # this is keyed by slug rather than a database id that doesn't exist
    # yet for a new note.
    _stage("filing_evidence")
    notes_by_slug = {n.get("slug"): n for n in existing_notes if n.get("slug")}
    for note in wiki_notes:
        notes_by_slug[note["slug"]] = {"slug": note["slug"], "title": note["title"], "body": note["body"]}
    evidence_filings, unfiled_all = file_evidence(candidates, list(notes_by_slug.values()))

    # unfiled/project-level split happens AFTER filing, never inside it — a
    # grant or trial that matched a note (real vocabulary overlap) is
    # already in evidence_filings and never reaches this split. Only items
    # that matched NOTHING get reclassified here, purely by kind: a grant
    # or trial that matched nothing is evidence for the PROJECT, not a sign
    # the wiki is missing a note — see split_unfiled's own docstring.
    unfiled_items, project_level_items = split_unfiled(unfiled_all)
    missing_note_suggestions = suggest_missing_notes(unfiled_items)
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
        "wiki_notes": wiki_notes,
        "evidence_filings": evidence_filings,
        "unfiled_items": unfiled_items,
        "project_level_items": project_level_items,
        "missing_note_suggestions": missing_note_suggestions,
        "digest": digest,  # {markdown, generated_at, counts} or None if the search failed entirely
        "candidates_found": candidates_found,
        "tools_called": explore_result.get("tools_called") or [],
        "warnings": warnings,
        "analysis_failed": False,
    }
