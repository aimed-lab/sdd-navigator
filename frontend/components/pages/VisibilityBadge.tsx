// Visibility pill for a living page: Private / Team / Public. Existing tokens
// only; brand green (primary) marks the shared states, neutral marks Private.

import { VISIBILITY_INFO, type PageVisibility } from "@/lib/server/pages/pageViewHelpers";

const ICON: Record<PageVisibility, string> = { private: "lock", team: "group", public: "public" };

const TONE: Record<PageVisibility, string> = {
  private: "bg-surface-container text-secondary",
  team: "bg-primary/10 text-primary",
  public: "bg-primary/10 text-primary",
};

export default function VisibilityBadge({ visibility }: { visibility: PageVisibility }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-label-sm text-label-sm " + TONE[visibility]
      }
    >
      <span className="material-symbols-outlined text-[14px]">{ICON[visibility]}</span>
      {VISIBILITY_INFO[visibility].label}
    </span>
  );
}
