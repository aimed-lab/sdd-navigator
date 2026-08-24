"""
tools/go_deeper.py — the researcher-triggered, single-question search.

NOT part of the fixed run_project_agent_async pipeline. That pipeline runs
once, broadly, over the whole project's stated goal, and stops — running it
again just repeats the same broad search. This is the other half of what
makes the wiki a LOOP rather than a single pass: a human picks ONE open
question from the project wiki (a note_type="question" note) and asks the
agent to search for JUST that question, specifically — not the project's
topic again.

WHY THE RESEARCHER PICKS, NOT THE AGENT: which open question actually
matters to a team's programme is not something literature analysis can
determine — see this feature's own spec. This module never chooses a
question to deepen; it only ever deepens the one it's handed.

REUSES explore_async() VERBATIM, fed the QUESTION'S OWN TEXT, not the
project's goal text. No new search machinery — same sources, same routing,
same caching. "No published data link RAB10 dephosphorylation to rescue of
dopaminergic neuron phenotypes" drives queries about RAB10 dephosphorylation
and neuronal rescue because that IS the input text handed to scope
extraction, exactly the same way a project's goal text already does for the
broad pass.

TWO ANSWERS, BOTH USEFUL:
  FOUND         — real evidence surfaced that addresses the question. The
                  note is rewritten to say so (note_type flips
                  question -> concept: an answered question is a concept,
                  not an open one anymore), citing what was found in the
                  agent's own words, grounded — never a title quoted as if
                  it were the team's own data. The found items are filed
                  under the note via file_evidence() — the SAME matcher
                  wiki_agent.py already uses for a broad run, not a new one.
  STILL NOTHING — nothing found addresses it. The note STAYS a question,
                  but is rewritten to record that it was actually searched
                  (not merely never looked at) and exactly which queries
                  came back empty. Per the feature's own spec, this is the
                  MORE valuable of the two outcomes, not a failure — a
                  confirmed absence is what justifies designing an
                  experiment, an assumed one is not.

GROUNDING GATE — same "prompt asks, code enforces" discipline as every
other write in this wiki (wiki_agent.py's _grounded(), project_agent.py's
_classify_grounding()). The "resolved" judgment is never trusted from the
model's own say-so: an "answer" that doesn't share real vocabulary with the
items it claims to cite is downgraded to STILL NOTHING in code, regardless
of what the model asserted.

NEVER OVERWRITES A HUMAN EDIT. This module only ever PROPOSES a note
rewrite; the actual write goes through frontend/lib/server/wikiNotes.ts's
saveWikiNotes(), the exact same path (and the exact same is_human_edited
guard) every other wiki write already uses. There is no separate,
weaker-guarded write path for this feature.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone

import llm
from tools.explore import explore_async
from tools.project_agent import _flatten_candidates
from tools.wiki_agent import _content_words, file_evidence

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 40  # smaller than project_agent.MAX_CANDIDATES(60) — a
                      # single-question search is narrower by construction,
                      # not because of a different cap philosophy
_JSON_RETRY_BACKOFF_SEC = 2.0

# Same discipline, same constant as project_agent.py's own
# _PROMPT_SUMMARY_MAX_CHARS — GEO dataset summaries alone were 38% of a
# broad run's prompt at full length; a narrow run gets fewer candidates but
# the SAME per-item verbosity problem, so the same trim applies here too.
_PROMPT_SUMMARY_MAX_CHARS = 400


def _curate_for_prompt(item: dict) -> dict:
    summary = item.get("summary")
    if summary and len(summary) > _PROMPT_SUMMARY_MAX_CHARS:
        summary = summary[:_PROMPT_SUMMARY_MAX_CHARS].rstrip() + "…"
    return {
        "id": item.get("id"),
        "kind": item.get("kind"),
        "title": item.get("title"),
        "summary": summary,
        "source": item.get("source"),
    }


_JUDGE_SYSTEM = (
    "You are checking whether a research team's OPEN QUESTION has been "
    "answered by a search run SPECIFICALLY for it.\n\n"
    "You will be given the question's own text and a list of candidate "
    "items (papers, datasets, trials, tools, gene sets, etc.) that search "
    "returned. Decide: does ANY candidate directly address this question — "
    "actually answer or bear on it, not just share a keyword? A candidate "
    "about the same gene or disease in an unrelated context does NOT "
    "answer the question.\n\n"
    "If at least one candidate genuinely addresses it: write a SHORT (2-3 "
    "sentence) answer in your own words, grounded in what was found — "
    "never quote a candidate's title as if it names a study or resource "
    "the team already has. List the ids of the candidates that support "
    "the answer.\n\n"
    "If nothing genuinely addresses it: say so. Do NOT pad the answer with "
    "loosely related results to avoid an empty answer — an honest "
    "'nothing found' is the valuable outcome here, not a failure to avoid.\n\n"
    'Return ONLY JSON: {"resolved": true|false, "answer": "<empty string '
    'if not resolved>", "supporting_item_ids": [...]}. No prose, no code '
    "fences."
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


def _try_judge_once(question_text: str, trimmed: list[dict], by_id: dict[str, dict]) -> dict | None:
    """One attempt at the judgment call + parse + grounding gate. Returns
    {"resolved", "answer", "supporting_items"} on success, or None if the
    JSON came back unusable (caller retries once). Raises on an actual
    LLM-call exception, same distinction as every other LLM step in this
    codebase."""
    resp = llm.complete(
        [
            {"role": "system", "content": _JUDGE_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"QUESTION: {question_text}\n\n"
                    f"Candidates found:\n{json.dumps(trimmed)}\n\n"
                    'Return ONLY {"resolved": true|false, "answer": "...", '
                    '"supporting_item_ids": [...]}.'
                ),
            },
        ],
        temperature=0.1,
    )
    data = _loads_lenient(resp.content)
    if not isinstance(data, dict) or not isinstance(data.get("resolved"), bool):
        return None

    resolved = data["resolved"]
    answer = data.get("answer") if isinstance(data.get("answer"), str) else ""
    raw_ids = data.get("supporting_item_ids")
    supporting_ids = [i for i in raw_ids if isinstance(i, str) and i in by_id] if isinstance(raw_ids, list) else []
    supporting_items = [by_id[i] for i in supporting_ids]

    if resolved and (not answer.strip() or not supporting_items):
        # A "yes" with no answer text or nothing to cite is not a real
        # resolution — same as an ungrounded answer below, treat as unresolved
        # rather than trust a bare true.
        resolved = False
        answer = ""
        supporting_items = []

    if resolved:
        # THE GATE: the answer must share real vocabulary with what it
        # claims to cite — a model asserting "resolved" on its own say-so is
        # not evidence. Same pattern as wiki_agent.py's _grounded().
        vocab: set[str] = set()
        for item in supporting_items:
            vocab |= _content_words(item.get("title")) | _content_words(item.get("summary"))
        if not (_content_words(answer) & vocab):
            logger.warning(
                "go_deeper: model claimed resolved but answer isn't grounded in its own "
                "cited items — downgrading to unresolved. question=%r answer=%r",
                question_text, answer,
            )
            resolved = False
            answer = ""
            supporting_items = []

    return {"resolved": resolved, "answer": answer.strip(), "supporting_items": supporting_items}


def _judge(question_text: str, candidates: list[dict]) -> tuple[dict, bool]:
    """Returns (judgment, used_fallback). judgment is always a usable dict
    (resolved=False, answer="", supporting_items=[] on total failure) —
    FAIL CLOSED, same as project_agent.py's relevance pass: a broken
    judgment call must never be reported as a confirmed 'still nothing',
    since nothing was actually judged. used_fallback=True signals the
    caller to say so rather than silently treating a failure as an honest
    empty answer."""
    if not candidates:
        return {"resolved": False, "answer": "", "supporting_items": []}, False

    by_id = {c["id"]: c for c in candidates}
    trimmed = [_curate_for_prompt(c) for c in candidates[:MAX_CANDIDATES]]

    try:
        out = _try_judge_once(question_text, trimmed, by_id)
        if out is not None:
            return out, False
        logger.warning("go_deeper: judgment JSON unusable (attempt 1/2), retrying once")
        time.sleep(_JSON_RETRY_BACKOFF_SEC)
        out = _try_judge_once(question_text, trimmed, by_id)
        if out is not None:
            return out, False
        logger.warning("go_deeper: judgment JSON unusable (attempt 2/2)")
    except Exception:
        logger.exception("go_deeper: judgment LLM call failed")

    return {"resolved": False, "answer": "", "supporting_items": []}, True


def _queries_tried(explore_result: dict) -> list[dict]:
    """[{tool, query}, ...] — the ACTUAL per-source query strings
    explore_async used, read straight off its own sections (each section
    already carries "query", see tools/explore.py's _execute()). Never
    reconstructed or guessed — this is what makes "searched N ways" an
    honest, checkable claim rather than a vague assertion."""
    out = []
    for section in explore_result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        out.append({"tool": section.get("tool"), "query": section.get("query")})
    return out


def _append_dated_section(body: str, heading: str, text: str) -> str:
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"{body.rstrip()}\n\n**{heading} ({date}):** {text}"


async def go_deeper_async(note: dict) -> dict:
    """Runs a narrow, question-specific search and returns a proposed note
    rewrite plus its evidence filing — never writes anything itself (see
    module docstring's "it proposes; the frontend persists" note).

    `note` is {"id", "slug", "title", "body", "note_type"} — the ONE
    question note the researcher picked. Not validated to actually be
    note_type="question" here; the caller (the HTTP route / the UI that
    only shows this action on a question note) is what enforces that.

    Returns:
      {
        resolved: bool,
        note: {slug, title, body, note_type},  # the proposed rewrite —
                                                 # body is the ORIGINAL body
                                                 # with a dated section
                                                 # appended, never replaced,
                                                 # so repeated go-deeper runs
                                                 # accumulate a record rather
                                                 # than erasing the last one
        evidence_filings: {slug: [{item, shared_terms}]},  # this note's
                                                 # slug only — file_evidence()
                                                 # run against a single-note
                                                 # list, same matcher as a
                                                 # broad run uses
        unfiled_items: [item],                  # candidates this narrow
                                                 # search found that didn't
                                                 # file under this note —
                                                 # never dropped, same rule
                                                 # as everywhere else
        queries_tried: [{tool, query}],
        tools_called: [str],
        judgment_failed: bool,                  # the LLM judgment itself
                                                 # broke (fail-closed) — NOT
                                                 # the same as a genuine
                                                 # "still nothing"; the
                                                 # caller should say so
                                                 # distinctly, not persist
                                                 # a rewrite at all in this
                                                 # case
      }
    """
    question_text = f"{note['title']}. {note.get('body') or ''}".strip()

    explore_result = await explore_async(question_text)
    candidates, _, _, _ = _flatten_candidates(explore_result, set(), max_candidates=MAX_CANDIDATES)
    tools_called = explore_result.get("tools_called") or []
    queries_tried = _queries_tried(explore_result)

    judgment, judgment_failed = _judge(question_text, candidates)

    if judgment_failed:
        logger.warning("go_deeper: judgment failed for note=%r — proposing no rewrite", note.get("slug"))
        return {
            "resolved": False,
            "note": None,
            "evidence_filings": {},
            "unfiled_items": [],
            "queries_tried": queries_tried,
            "tools_called": tools_called,
            "judgment_failed": True,
        }

    note_for_filing = [{"slug": note["slug"], "title": note["title"], "body": note.get("body") or ""}]
    filings, unfiled = file_evidence(candidates, note_for_filing)

    if judgment["resolved"]:
        new_body = _append_dated_section(note.get("body") or "", "Resolved", judgment["answer"])
        new_note = {
            "slug": note["slug"],
            "title": note["title"],
            "body": new_body,
            "note_type": "concept",  # an answered question is a concept now
        }
    else:
        query_summary = "; ".join(f"{q['tool']}: {q['query']}" for q in queries_tried if q.get("query"))
        still_nothing_text = (
            f"searched {len(queries_tried)} way(s) ({query_summary}) — no evidence found. "
            "Confirmed absence, not an unexamined gap."
        )
        new_body = _append_dated_section(note.get("body") or "", "Checked, still nothing", still_nothing_text)
        new_note = {
            "slug": note["slug"],
            "title": note["title"],
            "body": new_body,
            "note_type": "question",  # stays open — nothing resolved it
        }

    logger.info(
        "go_deeper: note=%r resolved=%s candidates=%d filed=%d unfiled=%d tools=%r",
        note.get("slug"), judgment["resolved"], len(candidates),
        len(filings.get(note["slug"], [])), len(unfiled), tools_called,
    )

    return {
        "resolved": judgment["resolved"],
        "note": new_note,
        "evidence_filings": filings,
        # file_evidence() already curates every item it hands back (both in
        # `filings` and here) — see that function's own docstring; nothing
        # further to curate.
        "unfiled_items": unfiled,
        "queries_tried": queries_tried,
        "tools_called": tools_called,
        "judgment_failed": False,
    }
