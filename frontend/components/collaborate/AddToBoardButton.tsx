"use client";

// Single primary entry point onto the board. Replaces what used to be two
// side-by-side buttons ("Add what your lab can share" / "Create post") — a
// visitor had to already know which they wanted before either label meant
// anything. Now there's one button and one question; both destinations are
// UNCHANGED (this only changes how you get to them), and ?community= carries
// through to either path exactly as it did before.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function AddToBoardButton({
  newPostHref,
  newResourceHref,
}: {
  newPostHref: string;
  newResourceHref: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
      >
        <span className="material-symbols-outlined">add</span>
        Add to the board
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="absolute right-0 z-20 mt-2 w-80 glass-panel rounded-2xl p-4 shadow-lg"
        >
          <p className="px-2 pb-3 font-label-md text-label-md text-secondary">
            What are you doing?
          </p>
          <Link
            href={newPostHref}
            role="menuitem"
            className="flex items-start gap-3 rounded-xl p-3 hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-primary mt-0.5">search</span>
            <span>
              <span className="block font-label-md text-label-md text-on-background">
                I&apos;m looking for something
              </span>
              <span className="block font-body-sm text-body-sm text-secondary">
                Post what you need and let the community come to you.
              </span>
            </span>
          </Link>
          <Link
            href={newResourceHref}
            role="menuitem"
            className="flex items-start gap-3 rounded-xl p-3 hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined text-primary mt-0.5">science</span>
            <span>
              <span className="block font-label-md text-label-md text-on-background">
                I have something to share
              </span>
              <span className="block font-body-sm text-body-sm text-secondary">
                Register a technique, resource, or piece of equipment.
              </span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
