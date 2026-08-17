"""
tools/prior_art_brief.py — the prior-art brief generator.

Given a project (name, description, target, indication, modality, stage),
gathers what has already been tried against the same target/mechanism and
renders a downloadable Markdown document. Serves ColaboFest's "Rigor and
innovation — differentiation from existing approaches" review criterion.

THE HARD CONSTRAINT — this module REPORTS, it never CONCLUDES. It must never
write a sentence like "this is novel" or "this has not been tried before." A
missing section says the search found nothing, not that nothing exists — the
absence of a hit is a fact about the search, not a fact about the world. Every
factual claim in the rendered document carries an inline citation (a name, a
sponsor, an NCT id, a URL); a sentence with no source attached does not belong
in the generator's output. Read this docstring before touching _render() —
that function is where the constraint actually gets enforced or violated.

NO LLM IN THE RENDER PATH. Sections 1, 3, 4, 5 and 6 are pure string
formatting from structured data (project fields, Item fields, trial `raw`
fields) — there is nothing for a model to phrase, and phrasing is exactly the
surface where "reports" quietly drifts into "concludes." The one LLM use in
this whole pipeline is indirect and reused, not new: explore_async() (see
tools/explore.py) runs its own scope-extraction + tool-routing Groq calls to
build the papers/tools/datasets/pager queries, the SAME machinery
tools/project_agent.py already relies on and that's cached per goal text. No
model call reads or writes a word of the rendered brief itself.

GATHERING
  * Papers  — explore_async(goal_text)'s search_papers section: the existing
    entity fan-out over PubMed/OpenAlex/Crossref, unmodified.
  * Tools, datasets, gene sets — the same explore_async() call's
    search_tools/search_datasets/search_pager sections. Tools whose last push
    (date_iso, sourced from GitHub's pushed_at) is over two years old are
    flagged, not excluded — a stale repo is still a prior attempt worth
    reporting.
  * Trials — NOT taken from explore_async's own search_trials section (that
    section carries no status filter). Two direct, disease-scoped calls to
    search_trials_async with `status_filter`: ["TERMINATED", "WITHDRAWN"] and
    ["RECRUITING"]. The query is the project's own `indication` (falling back
    to `target`, then the plain goal text) — never the LLM-extracted scope —
    matching tools/explore.py's own documented finding that ClinicalTrials.gov
    query.term is a strict-AND matcher and a disease name alone is what a
    trial record's title/condition field reliably contains.

WRITES NOTHING. Same contract as tools/project_agent.py: this module and the
HTTP route in server.py that calls it never touch Supabase. Generate, return,
done — persistence (once the project wiki exists) is a separate concern this
explicitly does not block on.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from models import Item
from tools.explore import explore_async
from tools.search_trials import search_trials_async

logger = logging.getLogger(__name__)

_TRIAL_LIMIT = 20        # per status-filtered trial call
_RECRUITING_LIMIT = 10
_STALE_TOOL_DAYS = 365 * 2   # "last push over two years old"


# ── input shaping ────────────────────────────────────────────────────────────


def _goal_text(project: dict) -> str:
    """Same "name + description beats keywords" input explore_async wants —
    see tools/project_agent.py's _project_goal_text, reused verbatim in spirit."""
    parts = []
    name = (project.get("name") or "").strip()
    description = (project.get("description") or "").strip()
    if name:
        parts.append(name)
    if description:
        parts.append(description)
    extra = [
        (project.get(k) or "").strip()
        for k in ("target", "indication", "modality", "stage")
        if (project.get(k) or "").strip()
    ]
    if extra:
        parts.append(" ".join(extra))
    return ". ".join(parts)


def _trial_query(project: dict, goal_text: str) -> str:
    """Disease-only, per tools/explore.py's documented strict-AND finding for
    ClinicalTrials.gov's query.term — never the LLM scope, never a joined
    multi-term string. indication > target > the raw goal text as a last
    resort (still ONE string, never several terms joined)."""
    indication = (project.get("indication") or "").strip()
    if indication:
        return indication
    target = (project.get("target") or "").strip()
    if target:
        return target
    return goal_text


# ── section 5 helpers: "what wasn't found" must name the search, not the world ──


def _not_found_line(kind_label: str, query: str, count: int) -> str | None:
    if count > 0:
        return None
    return f"- **{kind_label}** — the search for “{query}” returned no results."


# ── rendering ─────────────────────────────────────────────────────────────────


def _fmt_date(date_iso: str | None) -> str:
    if not date_iso:
        return "date unknown"
    try:
        d = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return date_iso
    if d.year < 2000:
        return "date unknown"
    return d.strftime("%b %d, %Y")


def _is_stale(date_iso: str | None) -> bool:
    if not date_iso:
        return False
    try:
        d = datetime.fromisoformat(date_iso.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - d).days > _STALE_TOOL_DAYS


def _project_facts(project: dict) -> list[tuple[str, str]]:
    """Verbatim project fields for section 1 — restated, never interpreted."""
    fields = [
        ("Name", project.get("name")),
        ("Description", project.get("description")),
        ("Target", project.get("target")),
        ("Indication", project.get("indication")),
        ("Modality", project.get("modality")),
        ("Stage", project.get("stage")),
    ]
    return [(label, (value or "").strip() or "(not set)") for label, value in fields]


def _render_paper(item: dict) -> str:
    title = item.get("title") or "(untitled)"
    date = _fmt_date(item.get("date_iso"))
    source = item.get("source") or "unknown source"
    summary = (item.get("summary") or "").strip()
    url = item.get("url")
    link = f" [{item.get('doi') or 'link'}]({url})" if url else ""
    line = f"- **{title}** — {source}, {date}.{link}"
    if summary:
        line += f"\n  {summary}"
    return line


def _render_tool(item: dict) -> str:
    title = item.get("title") or "(untitled)"
    url = item.get("url")
    summary = (item.get("summary") or "").strip()
    signal = item.get("signal") or {}
    stars = f"{int(signal['value'])} stars" if signal.get("metric") == "stars" else None
    pushed = item.get("date_iso")
    stale_flag = " ⚠️ **last push over 2 years ago — may be unmaintained**" if _is_stale(pushed) else ""
    meta_bits = [b for b in (stars, f"last push {_fmt_date(pushed)}") if b]
    meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
    line = f"- **[{title}]({url})**{meta}{stale_flag}"
    if summary:
        line += f"\n  {summary}"
    return line


def _render_dataset_or_geneset(item: dict) -> str:
    title = item.get("title") or "(untitled)"
    url = item.get("url")
    summary = (item.get("summary") or "").strip()
    link = f" [{title}]({url})" if url else f" {title}"
    line = f"-{link}"
    if summary:
        line += f" — {summary}"
    return line


def _render_stopped_trial(item: dict) -> str:
    raw = item.get("raw") or {}
    nct_id = raw.get("nct_id") or item.get("id", "").split(":")[-1]
    title = item.get("title") or "(untitled trial)"
    url = item.get("url")
    status = raw.get("overall_status") or "UNKNOWN"
    phase = raw.get("phase") or "phase not reported"
    sponsor = raw.get("lead_sponsor") or "sponsor not reported"
    enrollment = raw.get("enrollment")
    completion = raw.get("completion_date")
    why = raw.get("why_stopped")
    results_posted = raw.get("results_posted")

    lines = [f"### [{title}]({url}) — {status} ({nct_id})"]
    meta_bits = [f"Sponsor: {sponsor}", f"Phase: {phase}"]
    if enrollment:
        meta_bits.append(f"Enrollment: {enrollment}")
    if completion:
        meta_bits.append(f"Completion date: {completion}")
    meta_bits.append(f"Results posted: {'yes' if results_posted else 'no'}")
    lines.append("- " + " · ".join(meta_bits))
    if why:
        # QUOTED VERBATIM — the hard constraint. Never paraphrase whyStopped.
        lines.append(f'> "{why}"')
    else:
        lines.append("- No stated reason (`whyStopped`) was returned for this record.")
    lines.append("")
    return "\n".join(lines)


def _render_recruiting_trial(item: dict) -> str:
    raw = item.get("raw") or {}
    nct_id = raw.get("nct_id") or item.get("id", "").split(":")[-1]
    title = item.get("title") or "(untitled trial)"
    url = item.get("url")
    phase = raw.get("phase") or "phase not reported"
    sponsor = raw.get("lead_sponsor") or "sponsor not reported"
    return f"- **[{title}]({url})** ({nct_id}) — Sponsor: {sponsor} · Phase: {phase}"


def _render(
    project: dict,
    papers: list[dict],
    papers_query: str,
    stopped: list[dict],
    recruiting: list[dict],
    trial_query: str,
    tools_items: list[dict],
    tools_query: str,
    datasets_items: list[dict],
    datasets_query: str,
    pager_items: list[dict],
    pager_query: str,
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines: list[str] = []

    lines.append(f"# Prior-art brief — {project.get('name') or 'Untitled project'}")
    lines.append(f"*Generated {now}. This document reports search results; it draws no "
                  "conclusion about novelty. Absence of a result means the search below "
                  "did not find one, not that nothing exists.*")
    lines.append("")

    # 1 — what this project describes
    lines.append("## 1. What this project describes")
    lines.append("*Restated verbatim from the project record — not interpreted.*")
    lines.append("")
    for label, value in _project_facts(project):
        lines.append(f"- **{label}:** {value}")
    lines.append("")

    # 2 — what has been tried
    lines.append("## 2. What has been tried")
    lines.append("")
    lines.append(f"### Literature (query: “{papers_query}”, {len(papers)} result(s))")
    lines.append("")
    if papers:
        for p in papers:
            lines.append(_render_paper(p))
    else:
        lines.append(f"No papers were returned for “{papers_query}”.")
    lines.append("")

    lines.append(f"### Tools in this space (query: “{tools_query}”, {len(tools_items)} result(s))")
    lines.append("")
    if tools_items:
        for t in tools_items:
            lines.append(_render_tool(t))
    else:
        lines.append(f"No tools/repositories were returned for “{tools_query}”.")
    lines.append("")

    lines.append(
        f"### Datasets & gene sets (queries: “{datasets_query}” / “{pager_query}”, "
        f"{len(datasets_items)} dataset(s), {len(pager_items)} gene set(s))"
    )
    lines.append("")
    if datasets_items or pager_items:
        for d in datasets_items:
            lines.append(_render_dataset_or_geneset(d))
        for g in pager_items:
            lines.append(_render_dataset_or_geneset(g))
    else:
        lines.append(f"No datasets or gene sets were returned for “{datasets_query}” / “{pager_query}”.")
    lines.append("")

    # 3 — what has stopped
    lines.append("## 3. What has stopped")
    lines.append(
        f"*Terminated and withdrawn trials matching “{trial_query}” on ClinicalTrials.gov. "
        "Reasons are quoted directly from each record's `whyStopped` field, never paraphrased.*"
    )
    lines.append("")
    if stopped:
        for s in stopped:
            lines.append(_render_stopped_trial(s))
    else:
        lines.append(f"The search for terminated/withdrawn trials matching “{trial_query}” returned none.")
    lines.append("")

    # 4 — what is active now
    lines.append("## 4. What is active now")
    lines.append(f"*Currently recruiting trials matching “{trial_query}”.*")
    lines.append("")
    if recruiting:
        for r in recruiting:
            lines.append(_render_recruiting_trial(r))
    else:
        lines.append(f"The search for recruiting trials matching “{trial_query}” returned none.")
    lines.append("")

    # 5 — what the search did not find
    lines.append("## 5. What the search did not find")
    lines.append(
        "*Explicit, so this section is never read as a claim about what exists — only about "
        "what this run's queries returned.*"
    )
    lines.append("")
    not_found = [
        _not_found_line("Literature", papers_query, len(papers)),
        _not_found_line("Terminated/withdrawn trials", trial_query, len(stopped)),
        _not_found_line("Recruiting trials", trial_query, len(recruiting)),
        _not_found_line("Tools/repositories", tools_query, len(tools_items)),
        _not_found_line("Datasets", datasets_query, len(datasets_items)),
        _not_found_line("Gene sets", pager_query, len(pager_items)),
    ]
    not_found = [line for line in not_found if line]
    if not_found:
        lines.extend(not_found)
    else:
        lines.append("Every query below returned at least one result.")
    lines.append("")

    # 6 — sources
    lines.append("## 6. Sources")
    lines.append("*Every query run for this brief, and how many results each returned.*")
    lines.append("")
    lines.append("| Search | Query | Results |")
    lines.append("|---|---|---|")
    lines.append(f"| Literature (PubMed/OpenAlex/Crossref) | {papers_query} | {len(papers)} |")
    lines.append(f"| Terminated/withdrawn trials (ClinicalTrials.gov) | {trial_query} | {len(stopped)} |")
    lines.append(f"| Recruiting trials (ClinicalTrials.gov) | {trial_query} | {len(recruiting)} |")
    lines.append(f"| Tools (GitHub) | {tools_query} | {len(tools_items)} |")
    lines.append(f"| Datasets (NCBI GEO) | {datasets_query} | {len(datasets_items)} |")
    lines.append(f"| Gene sets (PAGER) | {pager_query} | {len(pager_items)} |")
    lines.append("")

    return "\n".join(lines)


# ── orchestration ─────────────────────────────────────────────────────────────


def _section_items_and_query(sections: list[dict], tool_name: str) -> tuple[list[dict], str]:
    for s in sections:
        if isinstance(s, dict) and s.get("tool") == tool_name:
            return (s.get("items") or []), (s.get("query") or "")
    return [], ""


async def generate_prior_art_brief_async(project: dict) -> dict:
    """Gather + render. Never raises for a normal upstream failure — each
    source degrades to an empty section (reported honestly in sections 5/6),
    same resilience contract as explore_async/project_agent."""
    goal_text = _goal_text(project)
    trial_query = _trial_query(project, goal_text)

    explore_result, stopped_items, recruiting_items = await asyncio.gather(
        explore_async(goal_text),
        search_trials_async(trial_query, _TRIAL_LIMIT, status_filter=["TERMINATED", "WITHDRAWN"]),
        search_trials_async(trial_query, _RECRUITING_LIMIT, status_filter=["RECRUITING"]),
        return_exceptions=True,
    )

    if isinstance(explore_result, Exception):
        logger.exception("prior_art_brief: explore_async failed", exc_info=explore_result)
        explore_result = {"sections": []}
    if isinstance(stopped_items, Exception):
        logger.exception("prior_art_brief: stopped-trials search failed", exc_info=stopped_items)
        stopped_items = []
    if isinstance(recruiting_items, Exception):
        logger.exception("prior_art_brief: recruiting-trials search failed", exc_info=recruiting_items)
        recruiting_items = []

    sections = explore_result.get("sections") or []
    papers, papers_query = _section_items_and_query(sections, "search_papers")
    tools_items, tools_query = _section_items_and_query(sections, "search_tools")
    datasets_items, datasets_query = _section_items_and_query(sections, "search_datasets")
    pager_items, pager_query = _section_items_and_query(sections, "search_pager")

    stopped_dicts = [i.model_dump() if isinstance(i, Item) else i for i in stopped_items]
    recruiting_dicts = [i.model_dump() if isinstance(i, Item) else i for i in recruiting_items]

    markdown = _render(
        project,
        papers, papers_query or goal_text,
        stopped_dicts, recruiting_dicts, trial_query,
        tools_items, tools_query or goal_text,
        datasets_items, datasets_query or goal_text,
        pager_items, pager_query or goal_text,
    )

    return {
        "markdown": markdown,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": {
            "papers": len(papers),
            "stopped_trials": len(stopped_dicts),
            "recruiting_trials": len(recruiting_dicts),
            "tools": len(tools_items),
            "datasets": len(datasets_items),
            "genesets": len(pager_items),
        },
    }


def generate_prior_art_brief(project: dict) -> dict:
    """Synchronous entry point (mirrors project_agent's run_project_agent)."""
    return asyncio.run(generate_prior_art_brief_async(project))
