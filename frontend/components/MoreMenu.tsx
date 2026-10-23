"use client";

// A small "More (⋯)" menu for owner actions on an item (Edit, Delete). Closes on
// Esc or a click outside. `up` opens it above the button (for items at the
// bottom of a card). Used by wiki pages, communities, Collaborate posts and
// Promote items so deleting is always found in the same place.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type MoreMenuItem = {
  label: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
};

export default function MoreMenu({
  items,
  up = false,
  className = "",
  buttonClassName = "",
}: {
  items: MoreMenuItem[];
  up?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (items.length === 0) return null;

  const row = "block w-full text-left px-4 py-2 font-label-sm text-label-sm hover:bg-surface-container-low";

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "inline-flex items-center gap-1 px-2 py-1 rounded-lg font-label-sm text-label-sm text-secondary hover:bg-surface-container-low hover:text-on-background transition-colors " +
          buttonClassName
        }
      >
        <span className="material-symbols-outlined text-lg">more_horiz</span>
        More
      </button>
      {open && (
        <div
          role="menu"
          className={
            "absolute right-0 z-30 w-44 rounded-lg bg-surface-container-lowest shadow-lg border border-outline-variant/30 overflow-hidden " +
            (up ? "bottom-full mb-1" : "top-full mt-1")
          }
        >
          {items.map((it) =>
            it.href ? (
              <Link
                key={it.label}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`${row} ${it.danger ? "text-error" : "text-on-background"}`}
              >
                {it.label}
              </Link>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className={`${row} ${it.danger ? "text-error" : "text-on-background"}`}
              >
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
