"use client";

// Search results page — /explore/<topic>. Same shell, grid, and category strip
// as the Explore feed, but scoped to a query: it POSTs { input: topic } to the
// explore backend and renders the routed sections. Selecting a category filters
// to that section; an empty selected category shows the A+D invitation card.
//
// PROJECT CONTEXT: arriving with ?project_id=&project_name= (from a
// project's "Explore for this project" button — see
// lib/projectTypes.ts:buildProjectExploreHref) puts a visible "Saving to
// <project>" banner up top and passes projectId down to every <ItemCard>,
// so its bookmark button saves INTO that project instead of being a bare
// local toggle. Re-searching from this page carries the same project
// context forward (see `submit` below) — losing it after one search would
// silently revert to local-toggle saving with no warning, which is worse
// than not having the integration at all. WITHOUT these params, this page
// behaves exactly as it always has: no banner, no project-aware saving,
// ItemCard's default (local-toggle) behavior untouched.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ItemCard, { SkeletonCard } from "@/components/ItemCard";
import CategoryStrip, { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
import CategoryEmptyCard from "@/components/CategoryEmptyCard";
import InlineFeedback from "@/components/feedback/InlineFeedback";
import { submitFeedbackAction } from "@/app/feedback/actions";
import type { ExploreItem, ExploreResponse, ExploreSection } from "@/types/explore";

const SECTION_TITLE: Record<string, string> = {
  news: "Industry News",
  paper: "Latest Papers",
  dataset: "Datasets",
  geneset: "Gene sets",
  compound: "Compounds",
  target: "Target-Disease Evidence",
  tool: "Trending Tools",
  trial: "Clinical Trials",
  grant: "Funding & Grants",
  episode: "From the Podcast",
  resource: "Lab Resources",
  person: "People",
};
const titleFor = (kind: string) =>
  SECTION_TITLE[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6";

// See app/explore/page.tsx for the rationale on this control — same option
// set/values, same tokens, kept in sync between the two pages.
const TRIAL_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "stopped", label: "Terminated / withdrawn" },
  { value: "recruiting", label: "Recruiting" },
];

function TrialStatusControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface-container-low border border-outline-variant/30 w-fit">
      {TRIAL_STATUS_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value || "any"}
            type="button"
            onClick={() => onChange(opt.value)}
            className={
              "px-3 py-1.5 rounded-md font-label-md text-label-md whitespace-nowrap transition-all " +
              (active
                ? "bg-secondary-container text-on-secondary-container font-semibold shadow-sm"
                : "text-secondary hover:text-on-background")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="w-1.5 h-8 bg-primary rounded-full" />
      <div>
        <h2 className="font-headline-lg text-headline-lg text-on-background">{title}</h2>
        {note && <p className="text-xs text-tertiary mt-0.5">{note}</p>}
      </div>
    </div>
  );
}

// Open Targets' association score aggregates evidence across source types
// (genetic association, literature, animal model, ...) via a weighted
// harmonic mean — it is not a biological-importance ranking, so a pair
// with many evidence types can outscore one with strong-but-narrow
// evidence. One short line here, not a card-level essay.
const TARGET_SECTION_NOTE =
  "Open Targets' association score reflects breadth of evidence sources, not biological importance.";

function SearchResults() {
  const router = useRouter();
  const params = useParams<{ topic: string }>();
  const searchParams = useSearchParams();
  const topic = decodeURIComponent(
    Array.isArray(params.topic) ? params.topic[0] : params.topic ?? ""
  );

  const projectId = searchParams.get("project_id") || undefined;
  const projectName = searchParams.get("project_name") || undefined;
  // ?trial_status=stopped|recruiting — see /explore/page.tsx for the full
  // rationale (UI-only).
  const trialStatusParam = searchParams.get("trial_status");
  const statusFilter =
    trialStatusParam === "stopped" ? ["TERMINATED", "WITHDRAWN"]
    : trialStatusParam === "recruiting" ? ["RECRUITING"]
    : undefined;
  // Carried forward on re-search (see `submit`) so project context
  // survives editing the query, not just the first arrival.
  const extraQs: Record<string, string> = {};
  if (projectId && projectName) {
    extraQs.project_id = projectId;
    extraQs.project_name = projectName;
  }
  if (trialStatusParam) extraQs.trial_status = trialStatusParam;
  const projectQs = Object.keys(extraQs).length > 0 ? `?${new URLSearchParams(extraQs).toString()}` : "";

  const [query, setQuery] = useState(topic); // search bar value (pre-filled)
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // FIRST LOAD ONLY: when arriving with a projectId (from "Explore for this
  // project" — see lib/projectTypes.ts:buildProjectExploreHref), `topic` is
  // the SHORT displayed string (project name, or target+indication), not
  // the rich search text — /api/explore derives the full context
  // server-side from projectId instead (see that route's own comment).
  // This ref is what limits that to the FIRST fetch only: any subsequent
  // re-search (the user edits the search box and submits — see `submit`
  // below, which carries projectId forward in the URL for saving purposes)
  // must search literally what they typed, not silently keep re-deriving
  // the original project context while ignoring their edit.
  const isFirstLoadRef = useRef(true);

  // (Re)fetch whenever the routed topic changes.
  useEffect(() => {
    let cancelled = false;
    const useProjectContext = isFirstLoadRef.current && !!projectId;
    isFirstLoadRef.current = false;
    setQuery(topic);
    setSelected(null);
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const body = useProjectContext
          ? { project_id: projectId }
          : {
              input: topic,
              ...(statusFilter !== undefined ? { status_filter: statusFilter } : {}),
            };
        const res = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as ExploreResponse;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectId is
    // read once via isFirstLoadRef, not meant to re-trigger this effect
  }, [topic, trialStatusParam]);

  // A+B rule (same as feed): 3+ -> full grid; 1-2 -> pooled "Also Found"; 0 hidden.
  const { fullSections, pooledItems } = useMemo(() => {
    const withItems = (data?.sections ?? []).filter((s) => s.items.length > 0);
    const full = withItems.filter((s) => s.items.length >= 3);
    const pooled = withItems
      .filter((s) => s.items.length >= 1 && s.items.length < 3)
      .flatMap((s) => s.items);
    return { fullSections: full, pooledItems: pooled };
  }, [data]);

  const totalItems = fullSections.reduce((n, s) => n + s.items.length, 0) + pooledItems.length;
  // Two DISTINCT settled failure shapes, never conflated:
  //   backendError — the search never actually ran (transport failure, or the
  //                  route itself reporting error:true). An availability
  //                  problem: we couldn't search, not that we searched and
  //                  found nothing.
  //   emptyResult  — the search ran, worked, and matched nothing. A coverage
  //                  problem: worth recording as a real signal about missing
  //                  sources, which backendError is not.
  // Both are "settled" (not loading) and mutually exclusive.
  const backendError = !loading && (failed || data?.error === true);
  const emptyResult = !loading && !backendError && totalItems === 0;
  const showError = backendError || emptyResult;

  // Auto-capture: page_path + the query, tagged with which of the two
  // settled outcomes it was, once per distinct topic. Fires for BOTH —
  // dropping backendError here would lose the exact signal this feature
  // exists for when the discovery backend is down (the expected case for
  // the info session). The ref (not state) is what makes this fire once per
  // topic: state would re-render and re-run the effect's dependency check on
  // every render, but the ref only changes when a topic actually gets
  // captured. Only fires on a SETTLED outcome — never while loading, and
  // never on a partial result (there is no partial state here: totalItems
  // reflects the full response once loading is false).
  const capturedTopicRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showError || capturedTopicRef.current === topic) return;
    capturedTopicRef.current = topic;
    submitFeedbackAction({
      page_path: `/explore/${encodeURIComponent(topic)}`,
      message: null,
      context: { query: topic, outcome: backendError ? "backend_error" : "empty" },
    });
  }, [showError, backendError, topic]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q && q !== topic) router.push(`/explore/${encodeURIComponent(q)}${projectQs}`);
  };

  const onTrialStatusChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("trial_status", value);
    else params.delete("trial_status");
    const qs = params.toString();
    router.push(qs ? `/explore/${encodeURIComponent(topic)}?${qs}` : `/explore/${encodeURIComponent(topic)}`);
  };

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-32">
      {/* Saving-to-project indicator — a save from this page must never go
          somewhere the visitor didn't expect, so this is not subtle. */}
      {projectId && projectName && (
        <div className="max-w-3xl mx-auto mb-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-label-md text-label-md">
            <span className="material-symbols-outlined text-[18px]">bookmark_added</span>
            Saving to <strong>{projectName}</strong>
          </div>
        </div>
      )}

      {/* Search (pre-filled, editable) */}
      <section className="max-w-3xl mx-auto mb-6">
        <form onSubmit={submit} className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder="Search papers, tools, trials, grants, podcast, people…"
            className="w-full h-16 px-6 pr-16 bg-white border border-outline-variant/40 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-sm text-body-lg font-body-lg placeholder:text-secondary/50 transition-all"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-3 top-3 bottom-3 btn-primary px-6 rounded-lg flex items-center justify-center"
          >
            <span className="material-symbols-outlined">search</span>
          </button>
        </form>
      </section>

      {/* Query heading */}
      <div className="mb-6 text-center">
        <p className="text-secondary font-body-md">
          Results for{" "}
          <span className="text-on-background font-headline-md">&ldquo;{topic}&rdquo;</span>
        </p>
      </div>

      {/* Category strip — the Podcast chip routes to /explore/podcast, carrying
          the routed topic so the episode grid opens scoped to the same search. */}
      <CategoryStrip selected={selected} onSelect={setSelected} query={topic} />

      {/* Filters — below the type tabs, scoped to the active one. Shows ONLY
          on the Trials tab — see app/explore/page.tsx for the full
          rationale (kept in sync between the two pages). Switching tabs
          does not clear trial_status from the URL/state; only visibility
          changes. */}
      {selected === "trial" && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-10">
          <div>
            <p className="mb-2 text-secondary font-label-md text-label-md">Trial status</p>
            <TrialStatusControl
              value={trialStatusParam ?? ""}
              onChange={onTrialStatusChange}
            />
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-16">
          {[0, 1].map((s) => (
            <section key={s}>
              <div className="h-8 w-48 rounded bg-surface-container mb-8 animate-pulse" />
              <div className={GRID}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Error / no results at all — copy differs by which settled outcome
          this was. A backend failure must never read like an empty search:
          "try a broader term" tells someone their query was the problem when
          the actual problem is that nothing searched at all. */}
      {!loading && showError && (
        <div className="max-w-md mx-auto text-center py-24">
          {backendError ? (
            <>
              <span className="material-symbols-outlined text-5xl text-secondary/50">
                cloud_off
              </span>
              <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
                Couldn&apos;t search right now
              </h2>
              <p className="mt-2 text-secondary font-body-md">
                The discovery backend didn&apos;t respond. This isn&apos;t about your
                search — please try again in a moment.
              </p>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-5xl text-secondary/50">
                search_off
              </span>
              <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
                No results for &ldquo;{topic}&rdquo;
              </h2>
              <p className="mt-2 text-secondary font-body-md">
                Try a broader term, or browse the full feed.
              </p>
            </>
          )}

          <button
            onClick={() => router.push("/explore")}
            className="mt-6 btn-primary px-6 py-2 rounded-lg font-label-md text-label-md"
          >
            Browse the full feed
          </button>

          {emptyResult && (
            <div className="mt-8 text-left">
              <InlineFeedback
                prompt="What were you hoping to find?"
                pagePath={`/explore/${encodeURIComponent(topic)}`}
                context={{ query: topic }}
              />
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {!loading && !showError && (() => {
        const activeSections =
          selected === null
            ? fullSections
            : (data?.sections ?? []).filter((s) => s.kind === selected && s.items.length > 0);
        const showPooled = selected === null && pooledItems.length > 0;

        // Selected category with no results -> the A+D invitation card.
        // FAILED vs GENUINELY EMPTY: a real per-tool failure (tools/explore.py
        // sets section.error when that tool's call raised) must not read as
        // "try a broader term" — that's a lie when the source never actually
        // searched. `activeSections`/`pooledItems` above are built from
        // `.items` alone and drop `.error`, so look it up separately, straight
        // from the raw response, for whichever kind is selected.
        if (selected !== null && activeSections.length === 0) {
          const failedSection = (data?.sections ?? []).find(
            (s) => s.kind === selected && !!s.error
          );
          return (
            <CategoryEmptyCard
              label={labelForKind(selected)}
              kind={selected}
              query={topic}
              failed={!!failedSection}
              onBrowseAll={() => setSelected(null)}
            />
          );
        }

        return (
          <div className="space-y-16">
            {activeSections.map((section: ExploreSection) => (
              <section key={section.tool}>
                <SectionHeader
                  title={titleFor(section.kind)}
                  note={section.kind === "target" ? TARGET_SECTION_NOTE : undefined}
                />
                <div className={GRID}>
                  {section.items.map((item: ExploreItem) => (
                    <ItemCard key={item.id} item={item} projectId={projectId} />
                  ))}
                </div>

                {/* Key Papers — same pool as "Latest Papers" above, re-ordered
                    by WINNER instead of date desc; a second subsection under
                    the existing Papers section/tab, not a new CategoryStrip
                    tab — see app/explore/page.tsx for the full rationale
                    (kept in sync between the two pages). "★ Key paper" is
                    the wording ItemCard already uses for a WINNER-ranked
                    item's badge. */}
                {section.kind === "paper" && (section.items_key?.length ?? 0) > 0 && (
                  <div className="mt-12">
                    <SectionHeader title="Key Papers" />
                    <div className={GRID}>
                      {section.items_key!.map((item: ExploreItem) => (
                        <ItemCard key={item.id} item={item} projectId={projectId} variant="key" />
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ))}

            {showPooled && (
              <section>
                <SectionHeader title="Also Found" />
                <div className={GRID}>
                  {pooledItems.map((item: ExploreItem) => (
                    <ItemCard key={item.id} item={item} projectId={projectId} />
                  ))}
                </div>
              </section>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// useSearchParams() must sit inside a Suspense boundary (see CLAUDE.md /
// app/explore/page.tsx's own version of this same wrapper).
export default function SearchResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-32">
          <div className={GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
