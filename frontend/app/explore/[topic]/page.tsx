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
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { labelForKind } from "@/components/CategoryStrip";
import CategoryEmptyCard from "@/components/CategoryEmptyCard";
import CommunityTiles from "@/components/explore/CommunityTiles";
import ExplorePageFrame from "@/components/explore/ExplorePageFrame";
import NewsFront from "@/components/explore/NewsFront";
import OtherSections from "@/components/explore/OtherSections";
import PaperList from "@/components/explore/PaperList";
import ResourceBento, { liveTile } from "@/components/explore/ResourceBento";
import { TILE_GRID, TrialTile } from "@/components/explore/ResultTiles";
import SectionHeading from "@/components/explore/SectionHeading";
import { BlockSkeleton, PageSkeleton } from "@/components/explore/Skeletons";
import InlineFeedback from "@/components/feedback/InlineFeedback";
import { submitFeedbackAction } from "@/app/feedback/actions";
import type { ExploreItem, ExploreResponse, ExploreSection } from "@/types/explore";
import type { CommunitySummaryItem } from "@/lib/server/communities";

// Section kinds hidden from the feed for now (portal quick fixes). Hidden,
// not removed: drop a kind from this set to bring its section back.
const HIDDEN_SECTION_KINDS = new Set(["grant"]);
const visibleSections = (data: ExploreResponse | null): ExploreSection[] =>
  (data?.sections ?? []).filter((s) => !HIDDEN_SECTION_KINDS.has(s.kind));

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

  // Communities matching this search — fetched separately from the explore
  // backend response below, since communities live in Supabase, not the
  // Python search backend (see /api/communities-summary's own comment).
  // Keyed on `topic` so re-searching re-scopes the match, same as the main
  // fetch below.
  const [communities, setCommunities] = useState<CommunitySummaryItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/communities-summary?q=${encodeURIComponent(topic)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { communities?: CommunitySummaryItem[] };
        if (!cancelled) setCommunities(json.communities ?? []);
      } catch {
        if (!cancelled) setCommunities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topic]);

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

  const sections = useMemo(() => visibleSections(data), [data]);
  const sectionOf = (kind: string) => sections.find((s) => s.kind === kind);
  const itemsOf = (kind: string): ExploreItem[] => sectionOf(kind)?.items ?? [];
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);

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
  // Zero backend items is only a genuinely empty result when communities
  // ALSO matched nothing — a search that turned up a matching community but
  // no papers/trials/etc. still found something and must not read as "no
  // results for X" (see the pinned Communities row below).
  const emptyResult = !loading && !backendError && totalItems === 0 && communities.length === 0;
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

  // ---- Per-view content (same components and look as /explore) -------------

  const select = (kind: string | null) => {
    setSelected(kind);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const emptyCategory = (kind: string) => (
    <CategoryEmptyCard
      label={labelForKind(kind)}
      kind={kind}
      query={topic}
      failed={!!sections.find((s) => s.kind === kind && !!s.error)}
      onBrowseAll={() => setSelected(null)}
    />
  );

  const resourceSection = (kind: "dataset" | "tool", title: string) => {
    const items = itemsOf(kind);
    if (items.length === 0) return null;
    return (
      <section key={kind}>
        <SectionHeading title={title} />
        <ResourceBento tiles={items.map(liveTile)} projectId={projectId} />
      </section>
    );
  };

  const trialSection = () => {
    const items = itemsOf("trial");
    if (items.length === 0) return null;
    return (
      <section key="trial">
        <SectionHeading title="Clinical trials" />
        <div className={TILE_GRID}>
          {items.map((item) => (
            <TrialTile key={item.id} item={item} projectId={projectId} />
          ))}
        </div>
      </section>
    );
  };

  const allView = () => {
    const papers = itemsOf("paper");
    const news = itemsOf("news");
    const handled = new Set(["paper", "dataset", "tool", "trial", "news"]);
    const rest = sections.filter((s) => !handled.has(s.kind) && s.items.length > 0);
    return (
      <div className="space-y-16">
        {papers.length > 0 && (
          <section>
            <SectionHeading title="Papers" />
            <PaperList
              items={papers}
              limit={6}
              onMore={() => select("paper")}
              projectId={projectId}
            />
          </section>
        )}
        {resourceSection("dataset", "Datasets")}
        {resourceSection("tool", "Tools")}
        {trialSection()}
        {news.length > 0 && (
          <section>
            <SectionHeading title="News" />
            <NewsFront items={news} onAllNews={() => select("news")} projectId={projectId} />
          </section>
        )}
        <CommunityTiles items={communities} />
        <OtherSections sections={rest} projectId={projectId} />
      </div>
    );
  };

  const selectedView = (kind: string) => {
    if (kind === "communities") {
      return communities.length === 0 ? (
        <div className="text-center py-20 text-secondary font-body-md">
          No communities found for &ldquo;{topic}&rdquo;.
        </div>
      ) : (
        <CommunityTiles items={communities} />
      );
    }

    const section = sectionOf(kind);
    if (!section || section.items.length === 0) return emptyCategory(kind);

    if (kind === "paper") {
      const key = section.items_key ?? [];
      return (
        <div className="space-y-14">
          <section>
            <SectionHeading title="Papers" />
            <PaperList items={section.items} projectId={projectId} />
          </section>
          {key.length > 0 && (
            <section>
              <SectionHeading title="Key papers" subtitle="The most influential in this set." />
              <PaperList items={key} projectId={projectId} />
            </section>
          )}
        </div>
      );
    }
    if (kind === "news") {
      return <NewsFront items={section.items} expanded projectId={projectId} />;
    }
    if (kind === "dataset" || kind === "tool") {
      return <div>{resourceSection(kind, kind === "dataset" ? "Datasets" : "Tools")}</div>;
    }
    if (kind === "trial") return <div>{trialSection()}</div>;
    return (
      <div className="space-y-14">
        <OtherSections sections={[section]} projectId={projectId} />
      </div>
    );
  };

  const banner =
    projectId && projectName ? (
      <div className="space-y-3 mb-6">
        {/* Way back to the project this search came from. */}
        <Link
          href={`/projects/${projectId}`}
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          {projectName}
        </Link>
        {/* Saving-to-project indicator: a save from this page must never go
            somewhere the visitor didn't expect, so this is not subtle. */}
        <div>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-label-md text-label-md">
            <span className="material-symbols-outlined text-[18px]">bookmark_added</span>
            Saving to <strong>{projectName}</strong>
          </div>
        </div>
      </div>
    ) : undefined;

  return (
    <ExplorePageFrame
      banner={banner}
      title={<>Results for &ldquo;{topic}&rdquo;</>}
      subtitle="Papers, datasets, tools, trials and news matching your search."
      search={{
        value: query,
        onChange: setQuery,
        onSubmit: submit,
        placeholder: "Search papers, tools, trials, podcast, people…",
      }}
      chips={{ selected, onSelect: select, query: topic }}
    >
      {/* Trial status filter, only on the Trials view. */}
      {selected === "trial" && (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-10">
          <div>
            <p className="mb-2 text-secondary font-label-md text-label-md">Trial status</p>
            <TrialStatusControl value={trialStatusParam ?? ""} onChange={onTrialStatusChange} />
          </div>
        </div>
      )}

      {/* Communities chip: independent of the explore-backend state. */}
      {selected === "communities" ? (
        selectedView("communities")
      ) : (
        <>
          {loading && (
            <div className="space-y-10">
              <BlockSkeleton className="h-40" />
              <BlockSkeleton className="h-64" />
            </div>
          )}

          {/* Error / no results at all. Copy differs by which settled outcome this
              was: a backend failure must never read like an empty search. */}
          {!loading && showError && (
            <div className="max-w-md mx-auto text-center py-16">
              {backendError ? (
                <>
                  <span className="material-symbols-outlined text-5xl text-secondary/50">
                    cloud_off
                  </span>
                  <h2 className="mt-4 font-title text-[24px] font-medium text-on-background">
                    Couldn&apos;t search right now
                  </h2>
                  <p className="mt-2 text-secondary font-body-md">
                    The discovery backend didn&apos;t respond. This isn&apos;t about your search,
                    please try again in a moment.
                  </p>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-5xl text-secondary/50">
                    search_off
                  </span>
                  <h2 className="mt-4 font-title text-[24px] font-medium text-on-background">
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

          {!loading && !showError && (selected === null ? allView() : selectedView(selected))}
        </>
      )}
    </ExplorePageFrame>
  );
}

// useSearchParams() must sit inside a Suspense boundary (see CLAUDE.md /
// app/explore/page.tsx's own version of this same wrapper).
export default function SearchResultsPage() {
  return (
    <Suspense
      fallback={<PageSkeleton />}
    >
      <SearchResults />
    </Suspense>
  );
}
