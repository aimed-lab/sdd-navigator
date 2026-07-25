"use client";

// Shared category switcher (Amazon-style) used by both the Explore feed and the
// search results page. "All" (kind=null) shows everything; a specific kind
// filters to that section. Horizontal scroll on mobile.

export const CATEGORIES: { label: string; kind: string | null }[] = [
  { label: "All", kind: null },
  { label: "Papers", kind: "paper" },
  { label: "Tools", kind: "tool" },
  { label: "Trials", kind: "trial" },
  { label: "Grants", kind: "grant" },
  { label: "Podcast", kind: "episode" },
  { label: "People", kind: "person" },
];

export const labelForKind = (kind: string | null) =>
  CATEGORIES.find((c) => c.kind === kind)?.label ?? "";

export default function CategoryStrip({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (kind: string | null) => void;
}) {
  return (
    <div className="flex gap-3 mb-12 overflow-x-auto no-scrollbar pb-1">
      {CATEGORIES.map((c) => {
        const active = selected === c.kind;
        return (
          <button
            key={c.label}
            onClick={() => onSelect(c.kind)}
            className={
              "px-6 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
              (active
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary")
            }
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
