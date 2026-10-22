// Promote — /promote. "What's new from our community".
//
// Editorial look shared with /explore: #FBFAF7 page, serif title, the same pill
// chips, tinted tiles (components/promote/ShowcaseCard.tsx). Nav/Footer come
// from the root layout.
//
// Top to bottom: the title and subtitle with one "+ Share your work" button,
// the type filter chips, a featured story shown large with its key facts (the
// newest one an admin featured, else the newest), two side cards, then a grid of
// the rest. Each type's card looks a little different (see ShowcaseCard.tsx)
// and ends with its main button.
//
// SERVER component: entries are in the HTML with no client fetch. The type
// filter is URL state (?type=), keeping every view linkable. Only PUBLISHED
// entries are listed (listShowcase filters on published=true). Submitting is the
// single flow at /promote/submit.

import Link from "next/link";
import ShowcaseCard from "@/components/promote/ShowcaseCard";
import { listShowcase } from "@/lib/server/showcase";
import { pickFeatured } from "@/lib/server/promote/showcaseKinds";
import { SHOWCASE_TYPES, SHOWCASE_TYPE_LABEL, type ShowcaseType } from "@/lib/showcaseTypes";

export const dynamic = "force-dynamic";

function chip(active: boolean) {
  return (
    "px-5 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-primary text-on-primary"
      : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary")
  );
}

function InvitationCard({ heading, body }: { heading: string; body: string }) {
  return (
    <Link
      href="/promote/submit"
      className="tile group p-8 flex flex-col items-center justify-center text-center min-h-[16rem]"
      style={{ background: "var(--type-other-bg)" }}
    >
      <h3 className="font-title text-[24px] font-medium text-on-background mb-2">{heading}</h3>
      <p className="font-body-md text-body-md text-secondary mb-5 max-w-xs">{body}</p>
      <span className="flex items-center gap-2 font-label-md text-label-md text-primary">
        Share your work
        <span className="material-symbols-outlined">arrow_forward</span>
      </span>
    </Link>
  );
}

export default async function PromotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.type) ? sp.type[0] : sp.type) ?? "";
  const type: ShowcaseType | "all" = (SHOWCASE_TYPES as readonly string[]).includes(raw)
    ? (raw as ShowcaseType)
    : "all";

  // All published items, then the filter in code: the chips need to know which
  // types have anything in them.
  const everything = await listShowcase({ type: "all" });
  const chipTypes = SHOWCASE_TYPES.filter((t) => t === type || everything.some((e) => e.type === t));
  const entries = type === "all" ? everything : everything.filter((e) => e.type === type);
  const filtered = type !== "all";

  const featured = pickFeatured(entries);
  const rest = entries.filter((e) => e.id !== featured?.id);
  const side = rest.slice(0, 2);
  const grid = rest.slice(2);

  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-32">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h1 className="font-title text-[34px] md:text-[44px] leading-[1.1] font-medium text-on-background">
              What&apos;s new from our community
            </h1>
            <p className="mt-3 font-body-lg text-body-lg text-secondary max-w-2xl">
              Papers, talks, events, funding wins, tools and more from researchers like you.
            </p>
          </div>
          <Link
            href="/promote/submit"
            className="btn-primary shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            <span className="material-symbols-outlined">add</span>
            Share your work
          </Link>
        </header>

        {/* "All" plus only the types that have at least one published item;
            wraps onto a second line instead of scrolling sideways. */}
        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/promote" className={chip(type === "all")}>
            All
          </Link>
          {chipTypes.map((t) => (
            <Link key={t} href={`/promote?type=${t}`} className={chip(type === t)}>
              {SHOWCASE_TYPE_LABEL[t]}
            </Link>
          ))}
        </div>

        {filtered && (
          <p className="mt-5 text-sm text-secondary/80">
            {entries.length} {entries.length === 1 ? "item" : "items"} ·{" "}
            <Link href="/promote" className="text-primary hover:underline underline-offset-4">
              Show all
            </Link>
          </p>
        )}

        {!featured ? (
          <div className="mt-8 max-w-xl mx-auto">
            <InvitationCard
              heading={filtered ? "Nothing here yet" : "Be the first to share"}
              body={
                filtered
                  ? "Nothing of this kind has been shared yet. Share yours and it appears here."
                  : "Put a paper, talk, event, funding win or tool in front of the community."
              }
            />
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {/* The featured story, large, with two side cards beside it on wide screens. */}
            <div className={side.length > 0 ? "grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start" : ""}>
              <ShowcaseCard entry={featured} featured />
              {side.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
                  {side.map((e) => (
                    <ShowcaseCard key={e.id} entry={e} compact />
                  ))}
                </div>
              )}
            </div>

            {grid.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {grid.map((e) => (
                  <ShowcaseCard key={e.id} entry={e} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
