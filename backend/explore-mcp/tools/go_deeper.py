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
from tools.project_agent import _GAP_PHRASES, _flatten_candidates
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


# SEPARATE prompt from _JUDGE_SYSTEM, not a reuse of it — confirmed live,
# 2026-08-23: framing the note's OWN existing body as a "candidate found by
# search" (the shape _JUDGE_SYSTEM expects) made the model refuse to call
# it resolved even when the body plainly already states a grounded,
# cited answer — a real research team's own note wasn't a "search result"
# to it, so it always said resolved=false. This prompt asks the actual
# question instead: does the text ALREADY answer this, regardless of
# where it came from.
_SELF_CHECK_SYSTEM = (
    "You will be given a QUESTION and the CURRENT TEXT of a note about it, "
    "written by a research team.\n\n"
    "Decide: does this text, AS IT ALREADY STANDS, contain a grounded, "
    "POSITIVE answer to the question — a specific claim with a stated "
    "source or citation?\n\n"
    "A text that states there is NO evidence, NO data, or that the "
    "question remains OPEN or UNRESOLVED is NOT an answer, even though it "
    "is a definite statement — that is a gap being recorded, not a "
    "question being answered. Only say yes when the text asserts "
    "something IS true/known, with support, not when it asserts that "
    "nothing is known.\n\n"
    "If yes: quote or closely paraphrase the positive answer already "
    "present in the text (do not invent anything beyond what the text "
    "already says).\n\n"
    "If the text is phrased as an open question, a gap statement, an "
    "absence of evidence, or has no cited support: say no.\n\n"
    'Return ONLY JSON: {"already_answered": true|false, "answer": "<empty '
    'string if false>"}. No prose, no code fences.'
)


def _try_self_check_once(question_text: str, note_body: str) -> dict | None:
    """One attempt at the self-check call + parse. Returns
    {"already_answered", "answer"} on success, None if unusable (caller
    retries once). Raises on an actual LLM-call exception.

    CODE GATE, same "prompt asks, code enforces" discipline as everywhere
    else: confirmed live, 2026-08-23, that the model can say
    already_answered=true for a body that literally states "no published
    data link X to Y" — treating a recorded ABSENCE as if it were an
    answer, because it's phrased as a confident, cited-sounding sentence.
    The SAME gap-phrase list project_agent.py's own grounding gate uses
    (_GAP_PHRASES) is checked against the returned answer text here — a
    "yes" whose own answer contains a gap phrase is downgraded to no,
    regardless of what the model asserted."""
    resp = llm.complete(
        [
            {"role": "system", "content": _SELF_CHECK_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"QUESTION: {question_text}\n\nCURRENT TEXT:\n{note_body}\n\n"
                    'Return ONLY {"already_answered": true|false, "answer": "..."}.'
                ),
            },
        ],
        temperature=0.1,
    )
    data = _loads_lenient(resp.content)
    if not isinstance(data, dict) or not isinstance(data.get("already_answered"), bool):
        return None
    answer = data.get("answer") if isinstance(data.get("answer"), str) else ""
    already = data["already_answered"] and bool(answer.strip())
    if already and any(phrase in answer.lower() for phrase in _GAP_PHRASES):
        logger.warning(
            "go_deeper: self-check said already_answered=true but the answer itself reads as a "
            "gap statement — downgrading to false. answer=%r", answer,
        )
        already = False
        answer = ""
    return {"already_answered": already, "answer": answer.strip() if already else ""}


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


def _classify_queries(queries_tried: list[dict], gene_terms: set[str]) -> dict:
    """Splits queries_tried into SPECIFIC (reflects the question's own
    content, beyond the bare gene/target symbol) and GENERIC (nothing but
    a gene symbol scope extraction already knew). Confirmed live,
    2026-08-23: search_datasets/pager/opentargets/chembl are GENE-PRIMARY
    tools by design (see tools/explore.py's _chembl_query/_opentargets_
    query docstrings — they resolve a target symbol, not free text), so
    several of them searching the identical bare gene symbol is normal,
    expected behavior, not four independent attempts at the specific
    question. Grouped by EXACT query text (case-insensitive) so identical
    generic queries from different tools collapse into ONE bucket — "four
    sources searching bare LRRK2 is one way, not five," per this
    feature's own spec, not five separate entries that inflate a
    'searched N ways' claim."""
    gene_terms_lower = {g.lower() for g in gene_terms}
    specific: dict[str, list[str]] = {}
    generic: dict[str, list[str]] = {}
    for q in queries_tried:
        query_text = (q.get("query") or "").strip()
        tool = q.get("tool")
        if not query_text or not tool:
            continue
        words = _content_words(query_text)
        bucket = generic if words and words <= gene_terms_lower else specific
        bucket.setdefault(query_text, []).append(tool)
    return {
        "specific": [{"query": q, "tools": tools} for q, tools in specific.items()],
        "generic": [{"query": q, "tools": tools} for q, tools in generic.items()],
    }


def _ways_searched_text(classified: dict) -> tuple[int, str, bool]:
    """Returns (n_ways, narrative, any_specific) — n_ways counts each
    distinct SPECIFIC query as its own way, plus at most ONE more for all
    generic (bare gene-level) queries combined, however many tools share
    them. any_specific=False means NOTHING beyond a bare gene/target
    symbol was ever searched — the caller uses this to downgrade language
    from "confirmed absence" to "inconclusive," since a bare gene lookup
    coming back empty says nothing about the SPECIFIC claim in the
    question."""
    specific = classified["specific"]
    generic = classified["generic"]
    parts = [f'{s["query"]!r} ({"/".join(s["tools"])})' for s in specific]
    if generic:
        all_tools = sorted({t for g in generic for t in g["tools"]})
        generic_query = generic[0]["query"]
        parts.append(f'a generic gene-level check ({generic_query!r}) across {len(all_tools)} database(s): {", ".join(all_tools)}')
    n_ways = len(specific) + (1 if generic else 0)
    return n_ways, "; ".join(parts), bool(specific)


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
        already_answered: bool,                 # the note's OWN existing
                                                 # body already grounds an
                                                 # answer (see STEP 0 below)
                                                 # — never combined with a
                                                 # "still nothing" verdict
        judgment_failed: bool,                  # the LLM judgment itself
                                                 # broke (fail-closed) — NOT
                                                 # the same as a genuine
                                                 # "still nothing"; the
                                                 # caller should say so
                                                 # distinctly, not persist
                                                 # a rewrite at all in this
                                                 # case
      }

    NEVER CONTRADICTS THE NOTE'S OWN BODY. Confirmed live, 2026-08-23: a
    note whose body already stated a grounded, cited answer got a "Checked,
    still nothing — confirmed absence" section appended underneath it —
    both readable in the same panel. STEP 0 below is the fix: before
    running the new search's own judgment, the SAME judge is asked whether
    the note's EXISTING body, on its own, already answers the question. If
    it does, this function NEVER produces a "still nothing" verdict — at
    worst it says the fresh search didn't add anything NEW beyond what the
    note already states, which is a true statement instead of a false one.
    """
    question_text = f"{note['title']}. {note.get('body') or ''}".strip()
    existing_body = note.get("body") or ""

    # STEP 0 — does the note's OWN existing body already answer this,
    # independent of anything a new search finds? Own small prompt (see
    # _SELF_CHECK_SYSTEM's own comment for why _JUDGE_SYSTEM itself doesn't
    # work for this), same one-retry-on-bad-JSON policy as everything else.
    already_answered = False
    if existing_body.strip():
        try:
            self_check = _try_self_check_once(question_text, existing_body)
            if self_check is None:
                time.sleep(_JSON_RETRY_BACKOFF_SEC)
                self_check = _try_self_check_once(question_text, existing_body)
        except Exception:
            self_check = None
            logger.exception(
                "go_deeper: self-check LLM call failed for note=%r — proceeding without it", note.get("slug")
            )
        if self_check and self_check["already_answered"]:
            already_answered = True

    explore_result = await explore_async(question_text)
    candidates, _, _, _ = _flatten_candidates(explore_result, set(), max_candidates=MAX_CANDIDATES)
    tools_called = explore_result.get("tools_called") or []
    queries_tried = _queries_tried(explore_result)
    gene_terms = set((explore_result.get("scope") or {}).get("genes") or [])
    classified = _classify_queries(queries_tried, gene_terms)
    n_ways, ways_narrative, any_specific = _ways_searched_text(classified)

    judgment, judgment_failed = _judge(question_text, candidates)

    if judgment_failed:
        logger.warning("go_deeper: judgment failed for note=%r — proposing no rewrite", note.get("slug"))
        return {
            "resolved": False,
            "note": None,
            "evidence_filings": {},
            "unfiled_items": [],
            "queries_tried": queries_tried,
            "ways_searched": n_ways,
            "tools_called": tools_called,
            "already_answered": already_answered,
            "judgment_failed": True,
        }

    note_for_filing = [{"slug": note["slug"], "title": note["title"], "body": existing_body}]
    filings, unfiled = file_evidence(candidates, note_for_filing)

    if judgment["resolved"]:
        # New evidence, from THIS run's search, resolves it.
        new_body = _append_dated_section(existing_body, "Resolved", judgment["answer"])
        new_note = {"slug": note["slug"], "title": note["title"], "body": new_body, "note_type": "concept"}
    elif already_answered:
        # THE FIX: the note already had a grounded answer BEFORE this run
        # — never say "still nothing" under it. Also corrects the
        # mislabeling this exact case exposed: a note tagged "question"
        # whose own body already reads as an answered concept.
        text = "this question already has a grounded answer above — a fresh search did not surface additional evidence beyond it."
        new_body = _append_dated_section(existing_body, "Re-checked, no new evidence", text)
        new_note = {"slug": note["slug"], "title": note["title"], "body": new_body, "note_type": "concept"}
    elif any_specific:
        # A genuine, question-specific search came back empty.
        still_nothing_text = (
            f"searched {n_ways} way(s) — {ways_narrative}. No evidence found. "
            "Confirmed absence, not an unexamined gap."
        )
        new_body = _append_dated_section(existing_body, "Checked, still nothing", still_nothing_text)
        new_note = {"slug": note["slug"], "title": note["title"], "body": new_body, "note_type": "question"}
    else:
        # NOTHING beyond a bare gene/target symbol was ever searched — a
        # generic lookup coming back empty says nothing about the
        # SPECIFIC claim in the question. Do not claim a confirmed
        # absence off that; say plainly that this wasn't a real test.
        inconclusive_text = (
            f"only a generic gene-level check was possible ({ways_narrative}) — no query reflecting "
            "this question's specific claim could be formed. Not a confirmed gap; treat as inconclusive."
        )
        new_body = _append_dated_section(existing_body, "Checked, inconclusive", inconclusive_text)
        new_note = {"slug": note["slug"], "title": note["title"], "body": new_body, "note_type": "question"}

    logger.info(
        "go_deeper: note=%r resolved=%s already_answered=%s any_specific=%s candidates=%d filed=%d "
        "unfiled=%d tools=%r",
        note.get("slug"), judgment["resolved"], already_answered, any_specific, len(candidates),
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
        # THE FIX for the "6 ways / 4 ways" self-contradiction: n_ways —
        # SPECIFIC queries counted individually, plus at most one more for
        # every GENERIC bare-gene-symbol query combined — is the exact
        # number _ways_searched_text already wove into the note body's own
        # "Checked, still nothing" / "inconclusive" narrative above. Handing
        # it back explicitly, rather than making the caller infer a count
        # from `queries_tried` (raw per-tool entries — several tools legally
        # share one identical query, so its length is a DIFFERENT, larger
        # number measuring something else: "how many tool calls ran," not
        # "how many distinct ways this searched"), is what lets the two
        # surfaces that report a "ways searched" figure — this note's own
        # body text and whatever summary the caller shows alongside it —
        # say the same number instead of two.
        "ways_searched": n_ways,
        "tools_called": tools_called,
        "already_answered": already_answered,
        "judgment_failed": False,
    }
