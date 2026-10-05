// Promote — /promote. The showcase gallery.
//
// Editorial look shared with /explore: #FBFAF7 page, Newsreader serif title,
// the same pill chips, tinted tiles (components/promote/ShowcaseCard.tsx). It was
// laid out from design/stitch/smartdrugdiscovery_promote_with_showcase_images. Nav/Footer come from the root layout,
// and per design/SHELL.md the Stitch file's own header/footer are ignored —
// along with its "1,200+ laboratories" CTA band, which is an invented statistic
// (see the no-fake-metrics rule established on the landing page).
//
// SERVER component: reads lib/server/showcase.ts directly, so entries are in
// the HTML with no client fetch. The type filter is URL state (?type=),
// keeping every view linkable. Submitting — DOI-sourced article generation,
// editing, media, publish — is the single flow at /promote/submit
// (components/promote/SubmitFlow.tsx); this page only lists PUBLISHED
// entries (listShowcase filters on published=true).

import Link from "next/link";
import ShowcaseCard from "@/components/promote/ShowcaseCard";
import { listShowcase } from "@/lib/server/showcase";
import { SHOWCASE_TYPES, SHOWCASE_TYPE_LABEL, type ShowcaseType } from "@/lib/showcaseTypes";

export const dynamic = "force-dynamic";

// Same pill as CategoryStrip's chips on Explore.
function chip(active: boolean) {
  return (
    "px-6 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
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
        Submit to the showcase
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

  const entries = await listShowcase({ type });
  const filtered = type !== "all";

  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-32">
      {/* ── Showcase ─────────────────────────────────────────────────────── */}
      <section>
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h1 className="font-title text-[34px] md:text-[44px] leading-[1.1] font-medium text-on-background">
              Promote
            </h1>
            <p className="mt-3 font-body-lg text-body-lg text-secondary max-w-2xl">
              Show the community what your lab has done — paste a DOI and get
              a shareable article, or submit a case study, white paper or
              milestone directly.
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-start md:items-end gap-2">
            <Link
              href="/promote/submit"
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              <span className="material-symbols-outlined">add</span>
              Submit to Showcase
            </Link>
            <p className="font-body-sm text-body-sm text-secondary md:text-right max-w-[16rem]">
              Have something to share? A paper, talk, poster, award or tool —
              takes a few minutes.
            </p>
          </div>
        </header>

        {/* Type filters */}
        <div className="mt-8 flex gap-3 overflow-x-auto no-scrollbar pb-1">
          <Link href="/promote" className={chip(type === "all")}>
            All
          </Link>
          {SHOWCASE_TYPES.map((t) => (
            <Link key={t} href={`/promote?type=${t}`} className={chip(type === t)}>
              {SHOWCASE_TYPE_LABEL[t]}
            </Link>
          ))}
        </div>

        <p className="mt-6 text-sm text-secondary/80">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
          {filtered && " · "}
          {filtered && (
            <Link href="/promote" className="text-primary hover:underline underline-offset-4">
              Show all
            </Link>
          )}
        </p>

        {entries.length === 0 ? (
          <div className="mt-8 max-w-xl mx-auto">
            <InvitationCard
              heading={filtered ? "Nothing here yet" : "Be the first to share"}
              body={
                filtered
                  ? "No entries of this kind yet — submit one and it appears here."
                  : "Put a case study, paper, white paper or lab milestone in front of the community."
              }
            />
          </div>
        ) : (
          // The trailing dashed "Have something to share?" card used to live
          // here, appended after the last entry — with any entry count not
          // a clean multiple of the column count, it broke a row instead of
          // filling it. That prompt now lives in the header, next to Submit
          // to Showcase, always visible regardless of how many entries
          // there are.
          //
          // The featured entry gets its OWN full-width row — no card shares
          // it. Two earlier versions put a second entry beside it (grid
          // col-span, then flex-basis widths) and stretched that entry to
          // match the featured card's height; for a card whose content is
          // just a headline and a meta line, that stretch is mostly empty
          // space with the date stranded at the bottom. There's no width
          // split that avoids that once a short card is forced to match a
          // tall one, so the fix is to never make it: featured is full
          // width, cover-left/text-right internally (ShowcaseCard.tsx) so
          // it isn't excessively tall itself, and everything else renders
          // below in ONE uniform grid, every item the same shape, so their
          // heights match because they're built the same, not because
          // something was forced. If that grid's last row isn't full,
          // that's just an ordinary short last row — the completely normal,
          // unremarkable way every card grid on the web ends when the count
          // isn't a clean multiple of the column count.
          <div className="mt-8 space-y-4">
            <ShowcaseCard entry={entries[0]} featured />

            {entries.length > 1 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {entries.slice(1).map((e) => (
                  <ShowcaseCard key={e.id} entry={e} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
    </div>
  );
}
