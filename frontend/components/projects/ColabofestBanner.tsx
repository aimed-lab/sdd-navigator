// The ColaboFest feature banner at the top of /projects.
//
// STRUCTURE.md: "only rendered when ColaboFest is currently open for entry —
// this is a global condition, not per-project." There is no admin toggle or
// settings row for that yet anywhere in the schema, so COLABOFEST_OPEN below
// is a plain constant standing in for it — flip it to false (or wire it to a
// real settings row) once the challenge closes or a second one needs
// scheduling. Documented here rather than silently hardcoding the banner on.
//
// COLABOFEST_DEADLINE lives right next to it for the same reason: ONE named
// constant, not a date scattered across the create form and the server
// action. ColaboFest 2026 closes 30 September 2026 — this is not the
// team's choice to make, so app/projects/actions.ts sets every ColaboFest
// project's deadline to this value SERVER-SIDE and the create form never
// asks for one. End-of-day UTC, not midnight, so the deadline reads as
// "through September 30", not "up to the start of it".
import Link from "next/link";

export const COLABOFEST_OPEN = true;
export const COLABOFEST_DEADLINE = "2026-09-30T23:59:59Z";

export default function ColabofestBanner() {
  if (!COLABOFEST_OPEN) return null;

  return (
    <section className="w-full rounded-2xl bg-primary-container/10 border border-primary/20 p-6 md:p-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
      <div className="flex flex-col gap-2">
        <span className="font-label-sm text-label-sm text-primary tracking-wider uppercase font-bold">
          Challenge
        </span>
        <h2 className="font-headline-lg text-headline-lg text-on-background">ColaboFest 2026</h2>
        <p className="font-body-md text-body-md text-secondary">
          Three awards of $20,000 in SPARC services. Submissions close September 30.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-6 shrink-0 w-full lg:w-auto">
        <Link
          href="/projects/new?colabofest=1"
          className="w-full sm:w-auto btn-outline px-6 py-3 rounded-lg font-label-md text-label-md flex items-center justify-center"
        >
          Start your ColaboFest project
        </Link>
        {/* The landing page's #collabofest section (dates, proposal
            outline, registration/info-session/announcement links, contact)
            has no OTHER in-app entry point since the hero button there was
            replaced with "Start project" — this is that entry point, per
            the Stitch design's own spec for this banner. */}
        <Link
          href="/#collabofest"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors whitespace-nowrap"
        >
          Learn more
        </Link>
      </div>
    </section>
  );
}
