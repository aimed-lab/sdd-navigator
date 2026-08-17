"""
tools/prior_art_brief.py — prior-art digest rendering.

Given a project (name, description, target, indication, modality, stage) and
search results ALREADY COLLECTED by the caller, renders a downloadable
Markdown digest of what has already been tried against the same target/
mechanism. Serves ColaboFest's "Rigor and innovation — differentiation from
existing approaches" review criterion.

PURE RENDERING MODULE, NO I/O. This used to also own the search (its own
explore_async() call plus two direct trial calls) via
generate_prior_art_brief_async(). That function is gone — the digest and the
project agent's resource/checklist proposals were each running a SEPARATE
explore_async() call over the SAME goal text, i.e. two full searches and two
sets of scope-extraction/routing Groq calls to produce two outputs that both
wanted the same candidate pool. tools/project_agent.py now runs the search
ONCE and calls render_digest() here with what it already collected — see that
module's run_project_agent_async for the merged pipeline. This module is left
with exactly what has no business making a network or LLM call: string
formatting.

THE HARD CONSTRAINT — this module REPORTS, it never CONCLUDES. It must never
write a sentence like "this is novel" or "this has not been tried before." A
missing section says the search found nothing, not that nothing exists — the
absence of a hit is a fact about the search, not a fact about the world. Every
factual claim in the rendered document carries an inline citation (a name, a
sponsor, an NCT id, a URL); a sentence with no source attached does not belong
in the generator's output. Read this docstring before touching render_digest()
— that function is where the constraint actually gets enforced or violated.

NO LLM IN THE RENDER PATH. Every line below is pure string formatting from
structured data (project fields, Item fields, trial `raw` fields) — there is
nothing for a model to phrase, and phrasing is exactly the surface where
"reports" quietly drifts into "concludes."

WHAT render_digest() EXPECTS THE CALLER TO HAVE ALREADY COLLECTED
  * Papers, tools, datasets, gene sets — the sections of an explore_async()
    result (search_papers/search_tools/search_datasets/search_pager). Tools
    whose last push (date_iso, sourced from GitHub's pushed_at) is over two
    years old are flagged, not excluded — a stale repo is still a prior
    attempt worth reporting.
  * Trials — NOT explore_async's own search_trials section (that section
    carries no status filter). Two direct, disease-scoped calls to
    search_trials_async with `status_filter`: ["TERMINATED", "WITHDRAWN"] and
    ["RECRUITING"] — trial_query() below builds the query the same way
    project_agent.py is expected to call search_trials_async with (the
    project's own `indication`, falling back to `target`, then the plain goal
    text — never the LLM-extracted scope, matching tools/explore.py's own
    documented finding that ClinicalTrials.gov query.term is a strict-AND
    matcher and a disease name alone is what a trial record's title/condition
    field reliably contains).

WRITES NOTHING. Same contract as tools/project_agent.py: nothing here (or the
HTTP route that eventually returns it) ever touches Supabase.
"""

from __future__ import annotations

from datetime import datetime, timezone

TRIAL_LIMIT = 20        # per status-filtered trial call
RECRUITING_LIMIT = 10
_STALE_TOOL_DAYS = 365 * 2   # "last push over two years old"


# ── input shaping ────────────────────────────────────────────────────────────


def trial_query(project: dict, goal_text: str) -> str:
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


def section_items_and_query(sections: list[dict], tool_name: str) -> tuple[list[dict], str]:
    """Pull one tool's (items, query) out of an explore_async() result's
    `sections` list. Exported — project_agent.py uses this on the SAME
    explore_result it already ran its own relevance pass over, rather than
    running a second search to get the same data."""
    for s in sections:
        if isinstance(s, dict) and s.get("tool") == tool_name:
            return (s.get("items") or []), (s.get("query") or "")
    return [], ""


def render_digest(
    project: dict,
    *,
    goal_text: str,
    sections: list[dict],
    stopped: list[dict],
    recruiting: list[dict],
) -> dict:
    """Render the digest from ALREADY-COLLECTED data — no search, no LLM call.
    `sections` is an explore_async() result's `sections` list; `stopped` and
    `recruiting` are already-`.model_dump()`-ed trial Items from the caller's
    own status-filtered search_trials_async calls (see trial_query() above for
    the query they should have been run with).

    Returns {markdown, generated_at, counts} — same shape the old standalone
    endpoint returned, so the frontend's handling of it doesn't change."""
    papers, papers_query = section_items_and_query(sections, "search_papers")
    tools_items, tools_query = section_items_and_query(sections, "search_tools")
    datasets_items, datasets_query = section_items_and_query(sections, "search_datasets")
    pager_items, pager_query = section_items_and_query(sections, "search_pager")
    papers_query = papers_query or goal_text
    tools_query = tools_query or goal_text
    datasets_query = datasets_query or goal_text
    pager_query = pager_query or goal_text
    query = trial_query(project, goal_text)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines: list[str] = []

    lines.append(f"# Prior-art digest — {project.get('name') or 'Untitled project'}")
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
        f"*Terminated and withdrawn trials matching “{query}” on ClinicalTrials.gov. "
        "Reasons are quoted directly from each record's `whyStopped` field, never paraphrased.*"
    )
    lines.append("")
    if stopped:
        for s in stopped:
            lines.append(_render_stopped_trial(s))
    else:
        lines.append(f"The search for terminated/withdrawn trials matching “{query}” returned none.")
    lines.append("")

    # 4 — what is active now
    lines.append("## 4. What is active now")
    lines.append(f"*Currently recruiting trials matching “{query}”.*")
    lines.append("")
    if recruiting:
        for r in recruiting:
            lines.append(_render_recruiting_trial(r))
    else:
        lines.append(f"The search for recruiting trials matching “{query}” returned none.")
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
        _not_found_line("Terminated/withdrawn trials", query, len(stopped)),
        _not_found_line("Recruiting trials", query, len(recruiting)),
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
    lines.append("*Every query run for this digest, and how many results each returned.*")
    lines.append("")
    lines.append("| Search | Query | Results |")
    lines.append("|---|---|---|")
    lines.append(f"| Literature (PubMed/OpenAlex/Crossref) | {papers_query} | {len(papers)} |")
    lines.append(f"| Terminated/withdrawn trials (ClinicalTrials.gov) | {query} | {len(stopped)} |")
    lines.append(f"| Recruiting trials (ClinicalTrials.gov) | {query} | {len(recruiting)} |")
    lines.append(f"| Tools (GitHub) | {tools_query} | {len(tools_items)} |")
    lines.append(f"| Datasets (NCBI GEO) | {datasets_query} | {len(datasets_items)} |")
    lines.append(f"| Gene sets (PAGER) | {pager_query} | {len(pager_items)} |")
    lines.append("")

    return {
        "markdown": "\n".join(lines),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": {
            "papers": len(papers),
            "stopped_trials": len(stopped),
            "recruiting_trials": len(recruiting),
            "tools": len(tools_items),
            "datasets": len(datasets_items),
            "genesets": len(pager_items),
        },
    }
