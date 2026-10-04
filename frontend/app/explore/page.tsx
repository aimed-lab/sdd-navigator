"use client";

// Explore feed: the default landing feed from the real explore backend, laid
// out like an editorial front page. Each content type has its own shape: news
// is a lead story plus headlines (NewsFront), papers are citation rows
// (PaperList), tools and datasets are pastel tiles (ResourceBento), the latest
// episode is one wide card (PodcastFeature). Tokens: lib/typeStyles.ts.
// Nav/Footer come from the shared shell (in the root layout).
//
// The feed is PERSONALIZED for a signed-in user with saved interests: the same
// blank-input request, which /api/explore scopes to those interests server-side
// (the browser is never told whose feed this is, and never asks for a scope).
// The response says which it got via scope.is_personalized, and the chips below
// the search bar show the terms it used. Signed out, or with no interests, this
// is exactly the generic field-wide feed it always was.
//
// The hand-picked bento (lib/curated.ts) never waits on the backend, so it still
// shows when the live feed is loading or has failed.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ItemCard, { SkeletonCard } from "@/components/ItemCard";
import CategoryStrip, { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
import CommunitiesResultsSection from "@/components/explore/CommunitiesResultsSection";
import CommunityTiles from "@/components/explore/CommunityTiles";
import HandPickedRow from "@/components/explore/HandPickedRow";
import NewsFront from "@/components/explore/NewsFront";
import PaperList from "@/components/explore/PaperList";
import PodcastFeature from "@/components/explore/PodcastFeature";
import ResourceBento, { liveTile } from "@/components/explore/ResourceBento";
import SectionHeading from "@/components/explore/SectionHeading";
import ScopeChips from "@/components/ScopeChips";
import type { ExploreItem, ExploreResponse, ExploreSection } from "@/types/explore";
import type { CommunitySummaryItem } from "@/lib/server/communities";

const SECTION_TITLE: Record<string, string> = {
  geneset: "Gene sets",
  compound: "Compounds",
  target: "Target-Disease Evidence",
  trial: "Clinical Trials",
  grant: "Funding & Grants",
  resource: "Lab Resources",
  person: "People",
};

// Section kinds hidden from the feed for now (portal quick fixes). Hidden,
// not removed: drop a kind from this set to bring its section back.
const HIDDEN_SECTION_KINDS = new Set(["grant"]);
const visibleSections = (data: ExploreResponse | null): ExploreSection[] =>
  (data?.sections ?? []).filter((s) => !HIDDEN_SECTION_KINDS.has(s.kind));

// Kinds the editorial components above render themselves. Everything else keeps
// the detailed ItemCard grid (trial status, compound facts, ... live there).
const EDITORIAL_KINDS = new Set(["news", "paper", "tool", "dataset", "episode"]);

const titleFor = (kind: string) =>
  SECTION_TITLE[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6";
const PAPERS_IN_ALL_VIEW = 6;
// Same honesty rule as the homepage: a count is only shown when it is real and
// at least this big.
const MIN_EPISODES_TO_SHOW = 10;

// "Trial status" — three mutually exclusive states, so a segmented control
// (one bordered track) rather than a pill row — matching
// components/projects/ChecklistSection.tsx's StatusControl and Collaborate's
// community segment() (app/collaborate/page.tsx): same bg-surface-container
// track, same bg-secondary-container/text-on-secondary-container "selected"
// treatment.
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

// Open Targets' association score aggregates evidence across source types
// (genetic association, literature, animal model, ...) via a weighted
// harmonic mean — it is not a biological-importance ranking, so a pair
// with many evidence types can outscore one with strong-but-narrow
// evidence. One short line here, not a card-level essay.
const TARGET_SECTION_NOTE =
  "Open Targets' association score reflects breadth of evidence sources, not biological importance.";

function BlockSkeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`rounded-[14px] bg-[#eeece6] animate-pulse ${className}`} />;
}

function FeedError() {
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <span className="material-symbols-outlined text-5xl text-secondary/50">cloud_off</span>
      <h2 className="mt-4 font-title text-[24px] font-medium text-on-background">
        Couldn&apos;t load the live feed right now
      </h2>
      <p className="mt-2 text-secondary font-body-md">
        The discovery backend didn&apos;t respond. Please try again in a moment.
      </p>
      <button
        onClick={() => location.reload()}
        className="mt-6 btn-primary px-6 py-2 rounded-lg font-label-md text-label-md"
      >
        Retry
      </button>
    </div>
  );
}

function ExploreFeed() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?category=<kind> preselects a section — this is how the chips on pages
  // without their own feed (e.g. /explore/podcast) route back in scoped.
  const categoryParam = searchParams.get("category");
  // ?scope=off — set when the user clears the last interest chip. The generic
  // feed is then what they asked for, so don't re-personalize it under them.
  const personalize = searchParams.get("scope") !== "off";
  // ?trial_status=stopped|recruiting — restricts the Clinical Trials section to
  // ClinicalTrials.gov's own overall-status values (same param the digest
  // already uses server-side). UI-only: never parsed from free text, only ever
  // set by this control. Unset = current, unfiltered behavior.
  const trialStatusParam = searchParams.get("trial_status");
  const statusFilter =
    trialStatusParam === "stopped" ? ["TERMINATED", "WITHDRAWN"]
    : trialStatusParam === "recruiting" ? ["RECRUITING"]
    : undefined;
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    categoryParam && CATEGORIES.some((c) => c.kind === categoryParam) ? categoryParam : null
  );

  // Communities — fetched separately from the explore backend response
  // above: communities live in Supabase, not the Python search backend, so
  // they're not one of `data.sections`. Blank query on this page (the
  // landing feed has no search text of its own) means "every community",
  // same as the old block above the search used to show unconditionally.
  // Podcast episode count for the stats line; null (hidden) until/unless it loads.
  const [episodeCount, setEpisodeCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/explore-stats");
        const json = (await res.json()) as { episodes?: number | null };
        if (!cancelled && typeof json.episodes === "number") setEpisodeCount(json.episodes);
      } catch {
        /* leave it hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [communities, setCommunities] = useState<CommunitySummaryItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/communities-summary", { cache: "no-store" });
        const json = (await res.json()) as { communities?: CommunitySummaryItem[] };
        if (!cancelled) setCommunities(json.communities ?? []);
      } catch {
        // Same "never break Explore over a widget" rule as the old block.
        if (!cancelled) setCommunities([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch("/api/explore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // empty input -> the landing feed; the route scopes it to the signed-in
          // user's interests unless personalization was explicitly turned off.
          body: JSON.stringify({
            input: "",
            personalize,
            ...(statusFilter !== undefined ? { status_filter: statusFilter } : {}),
          }),
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
  }, [personalize, trialStatusParam]);

  // The interests the feed was actually built from, straight from the response —
  // present only when the backend personalized it.
  const scopeTerms = useMemo(() => {
    if (data?.scope?.is_personalized !== true) return [];
    const topics = data.scope.topics;
    return Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string") : [];
  }, [data]);

  // Editing a chip leaves the personalized feed: what's left becomes an ordinary
  // search, and clearing the last one asks for the generic feed instead.
  const editScope = (remaining: string[]) => {
    router.push(
      remaining.length > 0
        ? `/explore/${encodeURIComponent(remaining.join(" "))}`
        : "/explore?scope=off"
    );
  };

  const sections = useMemo(() => visibleSections(data), [data]);
  const sectionOf = (kind: string) => sections.find((s) => s.kind === kind);
  const itemsOf = (kind: string): ExploreItem[] => sectionOf(kind)?.items ?? [];
  const totalItems = sections.reduce((n, s) => n + s.items.length, 0);

  // Zero backend items is only a real "empty/broken feed" when communities
  // ALSO have nothing to show — otherwise the pinned Communities row on
  // "All" would have something worth seeing, and the generic "couldn't load
  // the feed" card would be actively wrong.
  const showError =
    failed || data?.error === true || (!loading && totalItems === 0 && communities.length === 0);

  const qsParams = new URLSearchParams();
  if (trialStatusParam) qsParams.set("trial_status", trialStatusParam);
  const qs = qsParams.toString() ? `?${qsParams.toString()}` : "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/explore/${encodeURIComponent(q)}${qs}`);
  };

  const onTrialStatusChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("trial_status", value);
    else params.delete("trial_status");
    const qs = params.toString();
    router.push(qs ? `/explore?${qs}` : "/explore");
  };

  const select = (kind: string | null) => {
    setSelected(kind);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  // ---- Per-view content ---------------------------------------------------

  const resourceView = (kind: "tool" | "dataset") => {
    const live = itemsOf(kind);
    const noun = kind === "tool" ? "tools" : "datasets";
    return (
      <div className="space-y-14">
        <section>
          <SectionHeading
            title="Hand-picked"
            subtitle={`Open-source and public ${noun} we recommend, chosen by hand.`}
          />
          <HandPickedRow mode={kind} />
        </section>
        <section>
          <SectionHeading title="Live results" subtitle="Found by searching our sources today." />
          {loading ? (
            <BlockSkeleton className="h-40" />
          ) : live.length > 0 ? (
            <ResourceBento tiles={live.map(liveTile)} />
          ) : (
            <p className="text-secondary font-body-md">
              {failed || data?.error === true
                ? "Live results are unavailable right now."
                : `No live ${noun} in this feed yet.`}
            </p>
          )}
        </section>
      </div>
    );
  };

  const otherSections = (kinds: ExploreSection[]) =>
    kinds.map((section) => (
      <section key={section.tool}>
        <SectionHeading
          title={titleFor(section.kind)}
          subtitle={section.kind === "target" ? TARGET_SECTION_NOTE : undefined}
        />
        <div className={GRID}>
          {section.items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      </section>
    ));

  const allView = () => {
    const news = itemsOf("news");
    const papers = itemsOf("paper");
    const episodes = itemsOf("episode");
    const remaining = sections.filter((s) => !EDITORIAL_KINDS.has(s.kind) && s.items.length > 0);
    return (
      <div className="space-y-16">
        {/* 1. News front */}
        {loading ? (
          <BlockSkeleton />
        ) : showError ? (
          <FeedError />
        ) : (
          news.length > 0 && (
            <section>
              <SectionHeading title="In the news" subtitle="Headlines from across the industry." />
              <NewsFront items={news} onAllNews={() => select("news")} />
            </section>
          )
        )}

        {/* 2. Hand-picked bento: always shown, independent of the live feed */}
        <section>
          <SectionHeading
            title="Hand-picked tools and datasets"
            subtitle="Open-source and public resources we recommend."
          />
          <HandPickedRow mode="mix" onBrowseAll={() => select("tool")} />
        </section>

        {!loading && !showError && (
          <>
            {/* 3. Papers */}
            {papers.length > 0 && (
              <section>
                <SectionHeading title="New research" subtitle="The latest papers in the field." />
                <PaperList
                  items={papers}
                  limit={PAPERS_IN_ALL_VIEW}
                  onMore={() => select("paper")}
                />
              </section>
            )}

            {/* 4. Latest podcast episode (renders nothing without one) */}
            {episodes.length > 0 && (
              <section>
                <SectionHeading title="From the podcast" />
                <PodcastFeature items={episodes} />
              </section>
            )}

            {/* Communities: a place to join, not a document to read. */}
            <CommunityTiles items={communities} />

            {/* 5. Anything else the backend returned */}
            {otherSections(remaining)}
          </>
        )}
      </div>
    );
  };

  const selectedView = (kind: string) => {
    if (kind === "tool" || kind === "dataset") return resourceView(kind);

    if (loading) return <BlockSkeleton />;
    if (showError) return <FeedError />;

    if (kind === "news") {
      const news = itemsOf("news");
      return news.length > 0 ? (
        <NewsFront items={news} expanded />
      ) : (
        <p className="py-16 text-center text-secondary font-body-md">No news in this feed yet.</p>
      );
    }

    if (kind === "paper") {
      const section = sectionOf("paper");
      const latest = section?.items ?? [];
      const key = section?.items_key ?? [];
      if (latest.length === 0) {
        return (
          <p className="py-16 text-center text-secondary font-body-md">
            No papers in this feed yet.
          </p>
        );
      }
      return (
        <div className="space-y-14">
          <section>
            <SectionHeading title="Latest papers" />
            <PaperList items={latest} />
          </section>
          {key.length > 0 && (
            <section>
              <SectionHeading title="Key papers" subtitle="The most influential in this set." />
              <PaperList items={key} />
            </section>
          )}
        </div>
      );
    }

    // Any other kind (deep links such as ?category=trial): the detailed card grid.
    const section = sectionOf(kind);
    if (!section || section.items.length === 0) {
      return (
        <p className="py-16 text-center text-secondary font-body-md">
          No {labelForKind(kind).toLowerCase() || kind} in this feed yet.
        </p>
      );
    }
    return <div className="space-y-14">{otherSections([section])}</div>;
  };

  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-32">
        {/* Page heading */}
        <header className="max-w-3xl mb-8">
          <h1 className="font-title text-[34px] md:text-[44px] leading-[1.1] font-medium text-on-background">
            What&apos;s happening in drug discovery
          </h1>
          <p className="mt-3 font-body-lg text-body-lg text-secondary">
            Curated tools, live news and new research, updated daily.
          </p>
          <p className="mt-2 text-sm text-secondary/80">
            {[
              "Live across 7+ sources",
              episodeCount !== null && episodeCount >= MIN_EPISODES_TO_SHOW
                ? `${episodeCount} podcast episodes`
                : null,
              "updated daily",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>

        {/* Search */}
        <section className="max-w-3xl mb-8">
          <form onSubmit={submit} className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="text"
              placeholder="What are you working on? e.g. PHGDH in Alzheimer's, pancreatic cancer, CRISPR screening"
              className="w-full h-14 px-5 pr-16 bg-white border border-outline-variant/40 rounded-[14px] focus:ring-2 focus:ring-primary/20 focus:border-primary text-body-md font-body-md placeholder:text-secondary/50 transition-all"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-2.5 top-2.5 bottom-2.5 btn-primary px-5 rounded-lg flex items-center justify-center"
            >
              <span className="material-symbols-outlined">search</span>
            </button>
          </form>
        </section>

        {/* Scope chips — the interests this feed was built from (personalized only) */}
        <ScopeChips terms={scopeTerms} onEdit={editScope} />

        {/* Category strip — shared switcher; horizontal scroll on mobile. The
            Podcast chip routes to /explore/podcast rather than filtering inline. */}
        <div className="mt-6">
          <CategoryStrip selected={selected} onSelect={select} query={query} />
        </div>

        {/* Trial status filter, only on the Trials view (see earlier notes: the
            URL/state is kept when switching away, only visibility changes). */}
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

        {/* Communities chip — its own view, independent of the explore-backend
            state: communities never came from that backend, so a slow or failed
            Python backend must never block or error out this view. */}
        {selected === "communities" ? (
          communities.length === 0 ? (
            <div className="text-center py-20 text-secondary font-body-md">
              No communities found.
            </div>
          ) : (
            <CommunitiesResultsSection items={communities} />
          )
        ) : selected === null ? (
          allView()
        ) : (
          selectedView(selected)
        )}
      </div>
    </div>
  );
}

// useSearchParams() must sit inside a Suspense boundary (see CLAUDE.md).
export default function ExplorePage() {
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
      <ExploreFeed />
    </Suspense>
  );
}
