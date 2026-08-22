"""
response.py — trim Item payloads at the HTTP egress boundary.

WHY
───
`raw` carries each source's full record. For OpenAlex that is the entire work
object, including a `referenced_works` array of 150+ ids per paper. WINNER needs
those ids SERVER-SIDE to build the citation graph (ranking.py), but the browser
never reads them: a measured /api/explore response was 0.85 MB, of which 99% was
untrimmed `raw`.

So `raw` stays intact all the way through fetching, dedupe/merge and the WINNER
ranking step — and is trimmed only here, on the way out of the HTTP routes.

WHERE THIS SITS
───────────────
Egress only. The CACHE stores untrimmed items on purpose: a cached entry must
still be re-rankable server-side, and trimming is cheap (a dict comprehension)
compared with the serialization it saves.

WHAT SURVIVES
─────────────
Two different rules, because `raw` means two different things:

  * INTERNAL items (wiki episodes, lab resources, people) — `raw` IS the
    payload. The podcast pages read slug / episode_number / description /
    summary / concepts / tags / episode_url / image_url straight out of it.
    These pass through UNTOUCHED.

  * EXTERNAL items (openalex / pubmed / crossref / github / …) — the UI reads
    only two things from `raw`: `prior_signal` (the citation count preserved
    when WINNER replaces the signal — ItemCard renders "★ Key paper · N
    citations" from it) and `sources` (the contributing sources recorded by
    dedupe). Everything else is dropped. All the fields a card actually shows —
    title, summary, url, doi, date_iso, signal — are top-level Item fields and
    are never touched by any of this.

  * geo (sources/geo.py) is grouped with the INTERNAL rule, not the external
    one, despite being a live third-party fetch: its `raw` (accession,
    organism, sample_count, experiment_type, platform, pubmed_ids) is a
    handful of first-party structured fields with nowhere else to live — none
    of them are top-level Item fields, unlike papers' title/summary/url/doi.
    OpenAlex's trim exists because its `raw` is a 150+-id citation blob the
    UI never reads; GEO's `raw` is small and IS the payload, same as an
    internal wiki/lab_resources row. Trimming it to prior_signal/sources
    (both always absent for GEO — it carries no WINNER signal, see
    tools/search_datasets.py) would silently discard every dataset-specific
    field this fetcher exists to return.

  * pager (sources/pager.py) is grouped the same way, same reasoning: its
    `raw` (gs_id, type_code, type_label, source, size, ncoco_score) is a
    handful of small first-party fields PAGER's own search endpoint returns
    directly — nowhere else for them to live, and none of them are
    top-level Item fields. There is no large citation-graph-style blob to
    trim here either (unlike OpenAlex).

  * clinicaltrials (sources/clinical_trials.py) is grouped here too, added
    when the prior-art brief generator needed it. Its `raw` (overall_status,
    why_stopped, phase, interventions, lead_sponsor, completion_date,
    enrollment, results_posted) is the exact same shape as GEO's and pager's:
    a handful of small first-party fields with nowhere else to live, not a
    citation-graph blob. Before this was fixed, `raw` for a trial item was
    silently reduced to {} on every HTTP response (trials carry no
    prior_signal/sources), which would have quietly emptied whyStopped for
    every terminated/withdrawn trial the brief generator (tools/
    prior_art_brief.py) reads it from — the exact GEO failure mode this
    docstring already warns about, caught before shipping instead of after.
"""

from __future__ import annotations

from typing import Any, Iterable

# Sources whose `raw` is first-party content the UI renders directly.
_INTERNAL_SOURCES = {"internal", "geo", "pager", "clinicaltrials", "chembl"}

# For external items, the ONLY raw keys the frontend reads.
#   prior_signal -> components/ItemCard.tsx priorCitations()
#   sources      -> dedupe.merge_items(), shown as provenance
_EXTERNAL_RAW_KEEP = frozenset({"prior_signal", "sources"})


def trim_item(item: dict[str, Any]) -> dict[str, Any]:
    """Return `item` with a client-sized `raw`. Never mutates the input — the
    cache holds these dicts' source objects and must keep them intact."""
    if not isinstance(item, dict):
        return item

    raw = item.get("raw")
    if not isinstance(raw, dict) or not raw:
        return item

    # First-party payloads pass through — the UI reads them field by field.
    if item.get("source") in _INTERNAL_SOURCES:
        return item

    kept = {k: v for k, v in raw.items() if k in _EXTERNAL_RAW_KEEP}
    return {**item, "raw": kept}


def trim_items(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [trim_item(i) for i in items]


def trim_sections(sections: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Trim every item inside an explore() `sections` list.

    `items_key` — the papers section's second, WINNER-ranked ordering (see
    tools/explore.py's search_papers handling) — is the SAME kind of item
    payload as `items` and gets the same trim when present.
    """
    out: list[dict[str, Any]] = []
    for section in sections:
        if isinstance(section, dict) and isinstance(section.get("items"), list):
            trimmed: dict[str, Any] = {**section, "items": trim_items(section["items"])}
            if isinstance(section.get("items_key"), list):
                trimmed["items_key"] = trim_items(section["items_key"])
            out.append(trimmed)
        else:
            out.append(section)
    return out


def trim_explore_result(result: dict[str, Any]) -> dict[str, Any]:
    """Trim an explore() response. Returns a new dict; the cached original is
    left untouched."""
    if not isinstance(result, dict) or not isinstance(result.get("sections"), list):
        return result
    return {**result, "sections": trim_sections(result["sections"])}
