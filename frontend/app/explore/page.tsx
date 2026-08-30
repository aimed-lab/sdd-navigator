"use client";

// Explore feed — the default landing feed from the real explore backend. Layout
// follows design/stitch/smartdrugdiscovery_refined_explore_grid (the GRID
// version). Nav/Footer come from the shared shell (in the root layout).
//
// The feed is PERSONALIZED for a signed-in user with saved interests: the same
// blank-input request, which /api/explore scopes to those interests server-side
// (the browser is never told whose feed this is, and never asks for a scope).
// The response says which it got via scope.is_personalized, and the chips below
// the search bar show the terms it used. Signed out, or with no interests, this
// is exactly the generic field-wide feed it always was.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ItemCard, { SkeletonCard } from "@/components/ItemCard";
import CategoryStrip, { CATEGORIES, labelForKind } from "@/components/CategoryStrip";
import ScopeChips from "@/components/ScopeChips";
import GeneralFeedback from "@/components/feedback/GeneralFeedback";
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

  // A+B empty rule: 3+ items -> full grid section; 1-2 items -> pooled into
  // "Also Found"; 0 items -> hidden entirely.
  const { fullSections, pooledItems } = useMemo(() => {
    const withItems = (data?.sections ?? []).filter((s) => s.items.length > 0);
    const full = withItems.filter((s) => s.items.length >= 3);
    const pooled = withItems
      .filter((s) => s.items.length >= 1 && s.items.length < 3)
      .flatMap((s) => s.items);
    return { fullSections: full, pooledItems: pooled };
  }, [data]);

  const totalItems = fullSections.reduce((n, s) => n + s.items.length, 0) + pooledItems.length;
  const showError = failed || data?.error === true || (!loading && totalItems === 0);

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

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-32">
      {/* Search */}
      <section className="max-w-3xl mx-auto mb-10">
        <form onSubmit={submit} className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder="What are you working on? e.g. PHGDH in Alzheimer's, pancreatic cancer, CRISPR screening"
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

      {/* Scope chips — the interests this feed was built from (personalized only) */}
      <ScopeChips terms={scopeTerms} onEdit={editScope} />

      {/* Stat strip */}
      <div className="mb-6 py-3 border-y border-surface-variant/40 text-center">
        <p className="text-primary font-label-md text-label-md tracking-wide">
          Live across 7+ sources · 64 podcast episodes · papers, datasets, news, tools, trials, grants, people
        </p>
      </div>

      {/* Category strip — shared switcher; horizontal scroll on mobile. The
          Podcast chip routes to /explore/podcast rather than filtering inline. */}
      <CategoryStrip selected={selected} onSelect={setSelected} query={query} />

      {/* Filters — BELOW the type tabs, and scoped to the active one: the
          filter comes after the thing being filtered. "Trial status" only
          makes sense for trials, so it shows ONLY on the Trials tab — on
          "All" it read as page furniture since it only affects one of eight
          sections there. Switching away from Trials does NOT clear
          trial_status from the URL/state (see onTrialStatusChange /
          statusFilter above, both untouched) — only this control's
          visibility changes, so returning to Trials restores the previous
          choice, and status_filter keeps applying to the trial section
          exactly as before regardless of which tab is active. */}
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

      {/* Error / empty */}
      {!loading && showError && (
        <div className="max-w-md mx-auto text-center py-24">
          <span className="material-symbols-outlined text-5xl text-secondary/50">cloud_off</span>
          <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
            Couldn&apos;t load the feed right now
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
      )}

      {/* Feed */}
      {!loading && !showError && (() => {
        // "All" -> A+B feed (full sections + pooled). A specific category -> just
        // that kind's section (regardless of item count, so a small section is
        // still reachable via its chip).
        const activeSections =
          selected === null
            ? fullSections
            : (data?.sections ?? []).filter((s) => s.kind === selected && s.items.length > 0);
        const showPooled = selected === null && pooledItems.length > 0;
        const label = labelForKind(selected);

        if (selected !== null && activeSections.length === 0) {
          return (
            <div className="text-center py-20 text-secondary font-body-md">
              No {label.toLowerCase()} in this feed yet.
            </div>
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
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>

                {/* Key Papers — same pool as "Latest Papers" above, re-ordered
                    by WINNER instead of date desc. Lives as a second
                    subsection under the existing Papers section/tab rather
                    than a new top-level CategoryStrip tab: they're two views
                    of the same underlying set, and CategoryStrip is already
                    a no-wrap horizontal-scroll row on mobile that shouldn't
                    grow another chip for this. "★ Key paper" is the wording
                    ItemCard already uses for a WINNER-ranked item's badge —
                    reused here instead of inventing new vocabulary. */}
                {section.kind === "paper" && (section.items_key?.length ?? 0) > 0 && (
                  <div className="mt-12">
                    <SectionHeader title="Key Papers" />
                    <div className={GRID}>
                      {section.items_key!.map((item: ExploreItem) => (
                        <ItemCard key={item.id} item={item} variant="key" />
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
                    <ItemCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            )}
          </div>
        );
      })()}

      {/* Same mt-16 rhythm as the sections above (no isolating border-t) —
          the last section of the page, not an afterthought below one. See
          GeneralFeedback's own docstring on why it's placed right here,
          against the content, rather than down by the footer. */}
      <div className="mt-16">
        <GeneralFeedback subject="these search results" pagePath="/explore" />
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
