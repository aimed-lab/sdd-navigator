"use client";

// Bookmark toggle for the editorial components. Same behavior as ItemCard's
// bookmark:
//   * no projectId: a purely local toggle, nothing persisted;
//   * projectId + item: saves INTO that project (app/explore/actions.ts) with an
//     optimistic toggle that REVERTS and shows a visible error on failure, so a
//     search reached via "Explore for this project" still saves where the
//     visitor expects.
// Hidden until hover/focus on desktop, always visible on phones. The parent
// must have the `group` class.

import { useState } from "react";
import { removeFromProjectAction, saveToProjectAction } from "@/app/explore/actions";
import type { ExploreItem } from "@/types/explore";

export default function SaveButton({
  item,
  projectId,
  className = "",
}: {
  item?: ExploreItem;
  projectId?: string;
  className?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    if (!projectId || !item) {
      setSaved((s) => !s);
      return;
    }

    const next = !saved;
    setSaved(next); // optimistic
    setError(null);
    setPending(true);
    const res = next
      ? await saveToProjectAction(projectId, item)
      : await removeFromProjectAction(projectId, item.id);
    setPending(false);
    if (!res.ok) {
      setSaved(!next); // revert; the failure must be visible
      setError(res.error);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={saved ? "Remove bookmark" : "Save item"}
        aria-pressed={saved}
        className={
          "text-secondary hover:text-on-background transition-opacity shrink-0 disabled:opacity-50 " +
          "md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 " +
          (saved || error ? "md:opacity-100 " : "") +
          className
        }
      >
        <span
          className="material-symbols-outlined text-[22px] leading-none"
          style={{ fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0" }}
        >
          bookmark
        </span>
      </button>
      {error && (
        <span role="alert" className="basis-full text-xs text-error" onClick={(e) => e.stopPropagation()}>
          {error}
        </span>
      )}
    </>
  );
}
