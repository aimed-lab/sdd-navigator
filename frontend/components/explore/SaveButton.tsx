"use client";

// Bookmark toggle for the editorial components. Same behavior as ItemCard's
// bookmark when no project context is given: a purely local toggle, nothing
// persisted. Hidden until hover/focus on desktop, always visible on phones.
// The parent must have the `group` class.

import { useState } from "react";

export default function SaveButton({ className = "" }: { className?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSaved((s) => !s);
      }}
      aria-label={saved ? "Remove bookmark" : "Save item"}
      aria-pressed={saved}
      className={
        "text-secondary hover:text-on-background transition-opacity shrink-0 " +
        "md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 " +
        (saved ? "md:opacity-100 " : "") +
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
  );
}
