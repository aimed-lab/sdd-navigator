"use client";

// A+D invitation card — the empty state shown on the SEARCH results page when a
// selected category returns no results. Category-aware:
//   • INTERNAL categories (person, resource) LEAD with a contribute CTA →
//     Collaborate ("know one? Add it").
//   • EXTERNAL categories (paper, tool, trial, grant, episode) LEAD with a broaden
//     CTA → back to All ("try a broader term / browse the full feed").
// Both elements are always present; only the lead order changes with the type.

import Link from "next/link";

const INTERNAL_KINDS = new Set(["person", "resource"]);

export default function CategoryEmptyCard({
  label,
  kind,
  query,
  onBrowseAll,
}: {
  label: string;
  kind: string | null;
  query: string;
  onBrowseAll: () => void;
}) {
  const lower = label.toLowerCase();
  const internal = kind !== null && INTERNAL_KINDS.has(kind);

  // The two reusable elements (both always rendered; order depends on type).
  const contribute = (
    <Link href="/collaborate" className="btn-primary px-6 py-2 rounded-lg font-label-md text-label-md">
      Add to Collaborate
    </Link>
  );
  const browse = (
    <button onClick={onBrowseAll} className="btn-primary px-6 py-2 rounded-lg font-label-md text-label-md">
      Show all results
    </button>
  );

  return (
    <div className="glass-card rounded-xl max-w-xl mx-auto text-center px-8 py-14">
      <span className="material-symbols-outlined text-5xl text-primary/70">
        {internal ? "group_add" : "search_off"}
      </span>

      {internal ? (
        <>
          <h3 className="mt-4 font-headline-md text-headline-md text-on-background">
            No {lower} for &ldquo;{query}&rdquo; registered yet
          </h3>
          <p className="mt-2 text-secondary font-body-md">
            Know one? Help the community by adding them.
          </p>
          <div className="mt-6 flex justify-center">{contribute}</div>
          {/* secondary: broaden */}
          <p className="mt-4 text-secondary/80 text-body-sm font-body-sm">
            Or{" "}
            <button onClick={onBrowseAll} className="text-primary hover:underline">
              show all results
            </button>{" "}
            ·{" "}
            <Link href="/explore" className="text-primary hover:underline">
              browse the full feed
            </Link>
          </p>
        </>
      ) : (
        <>
          <h3 className="mt-4 font-headline-md text-headline-md text-on-background">
            No {lower} found for &ldquo;{query}&rdquo;
          </h3>
          <p className="mt-2 text-secondary font-body-md">
            Try a broader term or browse the full feed.
          </p>
          <div className="mt-6 flex justify-center">{browse}</div>
          {/* secondary: contribute */}
          <p className="mt-4 text-secondary/80 text-body-sm font-body-sm">
            Know a relevant one?{" "}
            <Link href="/collaborate" className="text-primary hover:underline">
              Add it to Collaborate
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
