// Promote — /promote. Showcase gallery + the paper→posts generator.
//
// Layout follows design/stitch/smartdrugdiscovery_promote_with_showcase_images,
// restyled in the shared design system. Nav/Footer come from the root layout,
// and per design/SHELL.md the Stitch file's own header/footer are ignored —
// along with its "1,200+ laboratories" CTA band, which is an invented statistic
// (see the no-fake-metrics rule established on the landing page).
//
// SERVER component for the gallery: it reads lib/server/showcase.ts directly, so
// entries are in the HTML with no client fetch. The type filter is URL state
// (?type=), keeping every view linkable. The generator below is a client island.

import Link from "next/link";
import GeneratorPanel from "@/components/promote/GeneratorPanel";
import ShowcaseCard from "@/components/promote/ShowcaseCard";
import { listShowcase } from "@/lib/server/showcase";
import { SHOWCASE_TYPES, SHOWCASE_TYPE_LABEL, type ShowcaseType } from "@/lib/showcaseTypes";

export const dynamic = "force-dynamic";

function chip(active: boolean) {
  return (
    "px-4 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-primary text-on-primary"
      : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary")
  );
}

function InvitationCard({ heading, body }: { heading: string; body: string }) {
  return (
    <Link
      href="/promote/submit"
      className="group border-2 border-dashed border-outline-variant/50 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-surface-container-low transition-all min-h-[16rem]"
    >
      <span className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
        <span className="material-symbols-outlined text-primary text-3xl">campaign</span>
      </span>
      <h3 className="font-headline-md text-lg text-on-background mb-2">{heading}</h3>
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
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16 space-y-20">
      {/* ── Showcase ─────────────────────────────────────────────────────── */}
      <section>
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h1 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
              Promote
            </h1>
            <p className="mt-3 font-body-lg text-body-lg text-secondary max-w-2xl">
              Show the community what your lab has done — and turn a paper into
              posts you can actually publish.
            </p>
          </div>
          <Link
            href="/promote/submit"
            className="btn-primary shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            <span className="material-symbols-outlined">add</span>
            Submit to Showcase
          </Link>
        </header>

        {/* Type filters */}
        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/promote" className={chip(type === "all")}>
            All
          </Link>
          {SHOWCASE_TYPES.map((t) => (
            <Link key={t} href={`/promote?type=${t}`} className={chip(type === t)}>
              {SHOWCASE_TYPE_LABEL[t]}
            </Link>
          ))}
        </div>

        <p className="mt-6 font-label-md text-label-md text-secondary">
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
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {entries.map((e) => (
              <ShowcaseCard key={e.id} entry={e} />
            ))}
            <InvitationCard
              heading="Have something to share?"
              body="Add your own case study, paper, white paper or milestone."
            />
          </div>
        )}
      </section>

      {/* ── Generator ────────────────────────────────────────────────────── */}
      <div className="border-t border-outline-variant/30 pt-16">
        <GeneratorPanel />
      </div>

    </div>
  );
}
