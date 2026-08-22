"use client";

import Link from "next/link";

// Shared category switcher (Amazon-style) used by the Explore feed, the search
// results page, and the podcast pages — one component so the row of chips is
// identical everywhere. "All" (kind=null) shows everything; a specific kind
// filters to that section. Horizontal scroll on mobile.
//
// Two modes:
//   • default — chips filter the CURRENT page in place (feed + search results).
//   • navigate — every chip is a link back into the feed (/explore?category=…).
//     Used by pages that have no feed of their own to filter, so the strip is a
//     way back into Explore instead of a dead end.
//
// Podcast is special in both modes: it has a destination of its own
// (/explore/podcast — all 64 episodes with their own search) rather than the
// handful the feed would show inline, so it always routes.

export const CATEGORIES: {
  label: string;
  kind: string | null;
  /** When set, the chip always routes here instead of filtering in place. */
  href?: string;
}[] = [
  { label: "All", kind: null },
  { label: "Papers", kind: "paper" },
  { label: "Datasets", kind: "dataset" },
  { label: "Gene sets", kind: "geneset" },
  { label: "Compounds", kind: "compound" },
  { label: "Targets", kind: "target" },
  { label: "Tools", kind: "tool" },
  { label: "Trials", kind: "trial" },
  { label: "Grants", kind: "grant" },
  { label: "Podcast", kind: "episode", href: "/explore/podcast" },
  { label: "People", kind: "person" },
];

export const labelForKind = (kind: string | null) =>
  CATEGORIES.find((c) => c.kind === kind)?.label ?? "";

/** Feed URL for a category chip — /explore for All, ?category=<kind> otherwise.
 *  The Explore feed reads `category` to preselect the matching section. */
export const exploreHrefForKind = (kind: string | null) =>
  kind ? `/explore?category=${encodeURIComponent(kind)}` : "/explore";

export default function CategoryStrip({
  selected,
  onSelect,
  query,
  navigate = false,
}: {
  selected: string | null;
  /** Omitted in `navigate` mode, where nothing filters in place. */
  onSelect?: (kind: string | null) => void;
  /** Current search text, carried to a routing chip so the destination keeps
   *  the user's scope instead of resetting to everything. */
  query?: string;
  /** Render every chip as a link back into the Explore feed. */
  navigate?: boolean;
}) {
  const pill = (active: boolean) =>
    "px-6 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-primary text-on-primary"
      : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary");

  const q = query?.trim();

  return (
    <div className="flex gap-3 mb-12 overflow-x-auto no-scrollbar pb-1">
      {CATEGORIES.map((c) => {
        // A chip with its own destination always links there.
        if (c.href) {
          return (
            <Link
              key={c.label}
              href={q ? `${c.href}?q=${encodeURIComponent(q)}` : c.href}
              className={pill(selected === c.kind)}
            >
              {c.label}
            </Link>
          );
        }

        // navigate mode: the rest link back into the feed, scoped to that kind.
        if (navigate) {
          return (
            <Link key={c.label} href={exploreHrefForKind(c.kind)} className={pill(selected === c.kind)}>
              {c.label}
            </Link>
          );
        }

        return (
          <button
            key={c.label}
            onClick={() => onSelect?.(c.kind)}
            className={pill(selected === c.kind)}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
