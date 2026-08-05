// The ColaboFest feature banner at the top of /projects.
//
// STRUCTURE.md: "only rendered when ColaboFest is currently open for entry —
// this is a global condition, not per-project." There is no admin toggle or
// settings row for that yet anywhere in the schema, so COLABOFEST_OPEN below
// is a plain constant standing in for it — flip it to false (or wire it to a
// real settings row) once the challenge closes or a second one needs
// scheduling. Documented here rather than silently hardcoding the banner on.

import Link from "next/link";

const COLABOFEST_OPEN = true;

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
      </div>
    </section>
  );
}
