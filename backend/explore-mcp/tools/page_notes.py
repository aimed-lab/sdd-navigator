"""
tools/page_notes.py — the page agent's own note writer: numbered, checkable
citations instead of wiki_agent.build_wiki_notes's "(paper)"-style prose.

WHY NOT EDIT wiki_agent.build_wiki_notes: the project agent shares it and is
left untouched. This module reuses its helpers (slugify, _loads_lenient,
MAX_NOTES, _NOTE_TYPES) and writes its own prompt + validation.

THE CONTRACT:
  * Only evidence with a title AND a real abstract/summary is shown to the
    model (see eligible_evidence). Anything thinner can't support a claim.
  * The model sees each item as [1], [2], ... and cites with those numbers.
  * CODE CHECK (validate_and_number), not just the prompt: any [n] that isn't
    one of the numbers actually handed to the model is stripped, a note left
    with zero valid citations is dropped, and the surviving citations are
    renumbered 1..K in order of first use across the whole page.
"""

from __future__ import annotations

import json
import logging
import re
import time

import llm
from tools.abstracts import has_abstract
from tools.wiki_agent import MAX_NOTES, _NOTE_TYPES, _content_words, _loads_lenient, slugify

logger = logging.getLogger(__name__)

MIN_SUMMARY_CHARS = 80      # shorter than this isn't an abstract
MAX_EVIDENCE_FOR_PROMPT = 30
MAX_SUMMARY_CHARS = 900
_RETRY_BACKOFF_SEC = 2.0

_CITE_RE = re.compile(r"\[(\d+)\]")

MAX_NOTES_PER_SOURCE = 2
DUP_JACCARD = 0.35   # with an identical citation set, notes this similar are one point
_OVERCLAIM_RE = re.compile(r"\b(consistent(?:ly)?|well[- ]known|well[- ]established|established)\b", re.I)

_SYSTEM = (
    "You are writing the notes for a short research overview page on one topic. "
    "You are given a numbered list of evidence items, each with a title and an "
    "abstract/summary. Cite them as [1], [2] ... using exactly those numbers.\n\n"
    "A NOTE IS A CONCEPT OR ENTITY (a target, mechanism, pathway, cell type, "
    "disease) or an explicit open question. It is never a paper.\n\n"
    "GROUNDING RULES — these are strict:\n"
    "- State ONLY what the provided abstracts support. No outside facts, no "
    "background knowledge, nothing from memory, even if you are sure it is true.\n"
    "- Every factual sentence must end with one or more [n] citations to the "
    "items that support it. Never cite a number that is not in the list. Never "
    "write '(paper)', '(trial)' or a bare title in place of a citation.\n"
    "- A finding from a single study must be worded cautiously: 'was reported', "
    "'suggests', 'may', never 'proves' or 'causes'. Only state something plainly "
    "if several cited items agree.\n"
    "- Never call a finding from one study or one dataset 'consistent', "
    "'established', or 'well known'. Those words need several independent items.\n"
    "- If the abstracts do not answer something, say that, or leave it out.\n\n"
    "DISTINCT NOTES: every note must make its own point. Do not restate the same "
    "finding in different words across notes; if two notes would say the same "
    "thing, write one. No single evidence item may be cited by more than "
    f"{MAX_NOTES_PER_SOURCE} notes. Fewer, distinct notes beat many overlapping ones.\n\n"
    "You may link other notes you are also writing with [[Note Title]]. "
    f"Write at most {MAX_NOTES} notes, fewer is fine. Each body is a short "
    "markdown paragraph or two.\n\n"
    'Return ONLY JSON: {"notes": [{"title": "...", "note_type": '
    '"concept|entity|question", "body": "..."}]}. No prose, no code fences.'
)


def eligible_evidence(candidates: list[dict]) -> list[dict]:
    """Candidates with a title plus a real abstract/summary, in original order,
    capped. These are the ONLY items the model sees."""
    out = []
    for c in candidates:
        title = (c.get("title") or "").strip()
        summary = (c.get("summary") or "").strip()
        if title and len(summary) >= MIN_SUMMARY_CHARS and has_abstract(c):
            out.append(c)
        if len(out) >= MAX_EVIDENCE_FOR_PROMPT:
            break
    return out


def _cites(body: str) -> list[int]:
    return [int(m) for m in _CITE_RE.findall(body)]


def _strip_cites(body: str, drop: set[int]) -> str:
    body = _CITE_RE.sub(lambda m: "" if int(m.group(1)) in drop else m.group(0), body)
    body = re.sub(r"[ \t]+([.,;:])", r"\1", body)
    return re.sub(r"[ \t]{2,}", " ", body).strip()


def _note_words(body: str) -> set[str]:
    return _content_words(_CITE_RE.sub("", body))


def validate_and_number(raw_notes: list[dict], n_given: int) -> tuple[list[dict], list[int], dict]:
    """The code-level checks, in order:
      1. strip any [n] outside 1..n_given; drop notes left uncited
      2. drop a note that restates an earlier one (same citation set AND
         content-word Jaccard >= DUP_JACCARD)
      3. cap each source at MAX_NOTES_PER_SOURCE notes: later notes lose that
         citation; notes left uncited are dropped
      4. strip any sentence calling a single-source note's finding
         'consistent' / 'established' / 'well known'
      5. renumber survivors 1..K in order of first use across the page

    Returns (notes, order, report). order[i] is the 0-based evidence index for
    final number i+1. report: {removed_citations, dropped_notes,
    removed_sentences}."""
    report: dict = {"removed_citations": [], "dropped_notes": [], "removed_sentences": []}
    work: list[dict] = []

    # 1
    for note in raw_notes:
        bad = {k for k in _cites(note["body"]) if not 1 <= k <= n_given}
        for k in sorted(bad):
            report["removed_citations"].append(
                {"note": note["title"], "cite": k, "why": "not an item the model was given"})
        body = _strip_cites(note["body"], bad)
        if not _cites(body):
            report["dropped_notes"].append({"note": note["title"], "reason": "no valid citations left"})
            continue
        work.append({**note, "body": body})

    # 2
    kept: list[dict] = []
    for note in work:
        cs, ws = set(_cites(note["body"])), _note_words(note["body"])
        dup_of = None
        for prev in kept:
            if set(_cites(prev["body"])) != cs:
                continue
            pw = _note_words(prev["body"])
            if ws and pw and len(ws & pw) / len(ws | pw) >= DUP_JACCARD:
                dup_of = prev["title"]
                break
        if dup_of:
            report["dropped_notes"].append({"note": note["title"], "reason": f"restates '{dup_of}'"})
        else:
            kept.append(note)
    work = kept

    # 3
    uses: dict[int, int] = {}
    kept = []
    for note in work:
        over = {k for k in set(_cites(note["body"])) if uses.get(k, 0) >= MAX_NOTES_PER_SOURCE}
        if over:
            for k in sorted(over):
                report["removed_citations"].append(
                    {"note": note["title"], "cite": k, "why": f"source already backs {MAX_NOTES_PER_SOURCE} notes"})
            note = {**note, "body": _strip_cites(note["body"], over)}
        if not _cites(note["body"]):
            report["dropped_notes"].append({"note": note["title"], "reason": "its only source(s) already back 2 notes"})
            continue
        for k in set(_cites(note["body"])):
            uses[k] = uses.get(k, 0) + 1
        kept.append(note)
    work = kept

    # 4
    kept = []
    for note in work:
        if len(set(_cites(note["body"]))) == 1 and _OVERCLAIM_RE.search(note["body"]):
            good = []
            for sent in re.split(r"(?<=[.!?])\s+", note["body"]):
                if _OVERCLAIM_RE.search(sent):
                    report["removed_sentences"].append({"note": note["title"], "sentence": sent})
                else:
                    good.append(sent)
            note = {**note, "body": " ".join(good).strip()}
            if not _cites(note["body"]):
                report["dropped_notes"].append(
                    {"note": note["title"], "reason": "nothing cited left after removing overclaim"})
                continue
        kept.append(note)

    # 5
    order: list[int] = []
    number_of: dict[int, int] = {}

    def _renumber(m: re.Match) -> str:
        k = int(m.group(1))
        if k not in number_of:
            order.append(k - 1)
            number_of[k] = len(order)
        return f"[{number_of[k]}]"

    final = [{**n, "body": _CITE_RE.sub(_renumber, n["body"])} for n in kept]
    return final, order, report


def _try_once(goal: str, evidence: list[dict]) -> list[dict] | None:
    listing = [
        {"n": i + 1, "title": e["title"], "abstract": e["summary"].strip()[:MAX_SUMMARY_CHARS]}
        for i, e in enumerate(evidence)
    ]
    resp = llm.complete(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"TOPIC: {goal}\n\nEVIDENCE: {json.dumps(listing)}"},
        ],
        temperature=0.2,
    )
    data = _loads_lenient(resp.content)
    raw = data.get("notes") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return None
    out = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        title, body, nt = entry.get("title"), entry.get("body"), entry.get("note_type")
        if not isinstance(title, str) or not title.strip() or not isinstance(body, str) or not body.strip():
            continue
        out.append({
            "title": title.strip()[:200],
            "note_type": nt if nt in _NOTE_TYPES else "concept",
            "body": body.strip(),
        })
        if len(out) >= MAX_NOTES:
            break
    return out


def build_page_notes(goal: str, candidates: list[dict]) -> dict:
    """Returns {notes, references, cited_evidence, report, evidence_given, fallback}.

    notes          — [{action:'create', note_id:None, slug, title, note_type, body}]
    references     — [{n, item_id, title}] in final numbering
    cited_evidence — {slug: [curated-source item dicts the note cites]} (raw
                     candidate dicts; caller curates)
    """
    evidence = eligible_evidence(candidates)
    empty = {"notes": [], "references": [], "cited_by_slug": {}, "report": {"removed_citations": [], "dropped_notes": [], "removed_sentences": []},
             "evidence_given": len(evidence), "fallback": False}
    if not evidence:
        return empty

    try:
        raw = _try_once(goal, evidence)
        if raw is None:
            time.sleep(_RETRY_BACKOFF_SEC)
            raw = _try_once(goal, evidence)
        if raw is None:
            return {**empty, "fallback": True}
    except Exception:
        logger.exception("page_notes: LLM call failed")
        return {**empty, "fallback": True}

    kept, order, report = validate_and_number(raw, len(evidence))
    references = [{"n": i + 1, "item_id": evidence[idx]["id"], "title": evidence[idx]["title"]}
                  for i, idx in enumerate(order)]

    notes, cited_by_slug = [], {}
    for note in kept:
        slug = slugify(note["title"])
        notes.append({"action": "create", "note_id": None, "slug": slug, "title": note["title"],
                      "note_type": note["note_type"], "body": note["body"]})
        nums = sorted({int(m) for m in _CITE_RE.findall(note["body"])})
        cited_by_slug[slug] = [(n, evidence[order[n - 1]]) for n in nums]
    return {**empty, "notes": notes, "references": references, "cited_by_slug": cited_by_slug,
            "report": report}
