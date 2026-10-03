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
  /** Chip is not rendered in the strip. The kind stays in this list so
   *  `?category=` deep links, labelForKind() and the pages' own lookups keep
   *  working; remove the flag to bring the chip back. */
  hidden?: boolean;
}[] = [
  { label: "All", kind: null },
  { label: "Papers", kind: "paper" },
  { label: "Datasets", kind: "dataset" },
  { label: "Tools", kind: "tool" },
  { label: "News", kind: "news" },
  { label: "Podcast", kind: "episode", href: "/explore/podcast" },
  // Hidden for now (portal quick fixes) — code kept, chips not shown.
  // Not an ExploreItem.kind (communities aren't a backend/Explore source —
  // they live in Supabase, not the Python search backend) — a UI-only kind
  // value the two pages that render this strip special-case to render
  // components/communities/CommunityCard instead of ItemCard.
  { label: "Communities", kind: "communities", hidden: true },
  { label: "Gene sets", kind: "geneset", hidden: true },
  { label: "Compounds", kind: "compound", hidden: true },
  { label: "Targets", kind: "target", hidden: true },
  { label: "Trials", kind: "trial", hidden: true },
  { label: "Grants", kind: "grant", hidden: true },
  { label: "People", kind: "person", hidden: true },
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
      {CATEGORIES.filter((c) => !c.hidden).map((c) => {
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
