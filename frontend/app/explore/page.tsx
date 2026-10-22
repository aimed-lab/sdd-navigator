"use client";

// Explore landing: one question, then four short blocks. In order: the big
// question box with example topics; "Your living pages" (signed in only);
// "Today in drug discovery" (four cards from the feed); "Browse" (one tab row
// showing one short list at a time, each with See all); "Communities near your
// work". Everything else the old landing stacked lives behind those tabs and
// links.
//
// ?category=<kind> still works: it opens that kind's full list (the "See all"
// links use it), with a way back to the landing.
//
// The feed is PERSONALIZED for a signed-in user with saved interests (the same
// blank-input request, which /api/explore scopes server-side). The chips that
// used to show those terms are gone from the landing; ?scope=off still turns
// personalization off.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
import CommunitiesNear from "@/components/explore/CommunitiesNear";
import ExploreShell from "@/components/explore/ExploreShell";
import HandPickedRow from "@/components/explore/HandPickedRow";
import JumpTo from "@/components/explore/JumpTo";
import { labPaperItems } from "@/components/explore/LabPapers";
import NewsFront from "@/components/explore/NewsFront";
import OtherSections from "@/components/explore/OtherSections";
import PaperList from "@/components/explore/PaperList";
import QuestionBox from "@/components/explore/QuestionBox";
import ResourceBento, { liveTile } from "@/components/explore/ResourceBento";
import SectionHeading from "@/components/explore/SectionHeading";
import { BlockSkeleton, PageSkeleton } from "@/components/explore/Skeletons";
import TodayCards from "@/components/explore/TodayCards";
import YourLivingPages from "@/components/explore/YourLivingPages";
import PageHeader from "@/components/PageHeader";
import {
  EXAMPLE_TOPICS,
  pickToday,
  scopeFromParam,
  scopeHref,
  sortGrantsByDeadline,
  sortTrialsRecruitingFirst,
  type ScopeKey,
} from "@/lib/server/explore/exploreLayout";
import type { ExploreItem, ExploreResponse, ExploreSection } from "@/types/explore";
import type { CommunitySummaryItem } from "@/lib/server/communities";

// Section kinds hidden from the feed for now (portal quick fixes). Hidden,
// not removed: drop a kind from this set to bring its section back.
const HIDDEN_SECTION_KINDS = new Set<string>();
const visibleSections = (data: ExploreResponse | null): ExploreSection[] =>
  (data?.sections ?? []).filter((s) => !HIDDEN_SECTION_KINDS.has(s.kind));

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
  const labItems = useMemo(() => labPaperItems(), []);
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // ?category=<kind> opens that kind's full list.
  const categoryScope = scopeFromParam(categoryParam);
  const selected: string | null =
    categoryScope !== "all"
      ? categoryScope
      : categoryParam && CATEGORIES.some((c) => c.kind === categoryParam)
        ? categoryParam
        : null;

  // Communities — fetched separately from the explore backend response
  // above: communities live in Supabase, not the Python search backend, so
  // they're not one of `data.sections`. Blank query on this page (the
  // landing feed has no search text of its own) means "every community",
  // same as the old block above the search used to show unconditionally.
  // Podcast episode count for the Jump-to tile; null (no number shown) until/unless it loads.
  const [episodeCount, setEpisodeCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/explore-stats");
        const json = (await res.json()) as { episodes?: number | null };
        if (!cancelled && typeof json.episodes === "number") setEpisodeCount(json.episodes);
      } catch {
        /* the tile just shows no number */
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

  useEffect(() => {
    if (categoryScope === "episode") router.replace("/explore/podcast");
  }, [categoryScope, router]);

  const goToTopic = (topic: string, scope: ScopeKey = "all") => router.push(scopeHref(scope, topic));

  const onTrialStatusChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("trial_status", value);
    else params.delete("trial_status");
    const qs = params.toString();
    router.push(qs ? `/explore?${qs}` : "/explore");
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
    // Open grants show the soonest deadline first, trials the recruiting ones first.
    const base = sectionOf(kind);
    const section =
      base && kind === "grant"
        ? { ...base, items: sortGrantsByDeadline(base.items) }
        : base && kind === "trial"
          ? { ...base, items: sortTrialsRecruitingFirst(base.items) }
          : base;
    if (!section || section.items.length === 0) {
      return (
        <p className="py-16 text-center text-secondary font-body-md">
          No {labelForKind(kind).toLowerCase() || kind} in this feed yet.
        </p>
      );
    }
    return <div className="space-y-14">
        <OtherSections sections={[section]} expandGenesets={kind === "geneset"} />
      </div>;
  };

  const hero = (
    <>
      <PageHeader
        title="Explore"
        subtitle="Explore biomedical research: ask a question or jump straight to what you need."
        className="mb-6"
      />
      <QuestionBox
        placeholder="Ask a question, e.g. dementia care in rural communities, KRAS in pancreatic cancer"
        examples={EXAMPLE_TOPICS}
        onSubmit={goToTopic}
      />
      <JumpTo episodeCount={episodeCount} />
    </>
  );

  // A full list (?category=<kind>, the "See all" links): the old per-kind view,
  // with a way back to the landing.
  if (selected !== null) {
    return (
      <ExploreShell>
        <Link
          href="/explore"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1 mb-4"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Explore
        </Link>
        <PageHeader title={labelForKind(selected) || "Explore"} className="mb-6" />
        <div className="mb-10">
          <QuestionBox placeholder="Ask a question" initialScope={categoryScope} onSubmit={goToTopic} />
        </div>
        {selected === "trial" && (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-10">
            <div>
              <p className="mb-2 text-secondary font-label-md text-label-md">Trial status</p>
              <TrialStatusControl value={trialStatusParam ?? ""} onChange={onTrialStatusChange} />
            </div>
          </div>
        )}
        {selected === "communities" ? (
          communities.length === 0 ? (
            <div className="text-center py-20 text-secondary font-body-md">No communities found.</div>
          ) : (
            <CommunitiesNear items={communities} />
          )
        ) : selected === "tool" ? (
          <div className="space-y-14">
            {resourceView("tool")}
            {resourceView("dataset")}
          </div>
        ) : (
          selectedView(selected)
        )}
      </ExploreShell>
    );
  }

  const today = pickToday({
    approvals: itemsOf("approval"),
    news: itemsOf("news"),
    labPapers: labItems,
    trials: itemsOf("trial"),
    episodes: itemsOf("episode"),
    papers: itemsOf("paper"),
  });

  return (
    <ExploreShell>
      {hero}
      <div className="mt-12 flex flex-col gap-14">
        <YourLivingPages />
        {loading ? <BlockSkeleton className="h-40" /> : showError ? <FeedError /> : <TodayCards cards={today} />}
        <CommunitiesNear items={communities} />
      </div>
    </ExploreShell>
  );
}

// useSearchParams() must sit inside a Suspense boundary (see CLAUDE.md).
export default function ExplorePage() {
  return (
    <Suspense
      fallback={<PageSkeleton />}
    >
      <ExploreFeed />
    </Suspense>
  );
}
