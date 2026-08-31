"use client";

// Collapsible "Manage community" card — collapsed by default, same
// disclosure idiom as CreateProjectForm's "Entering a challenge?" section
// (a full-width button header, expand_more icon rotating open/closed).
// Everything the admin panel does (pending requests, add by email, member
// roster, Leave + Delete community at the bottom) is passed in as
// children, unchanged — this component only owns the open/closed state.

import { useState } from "react";

export default function ManageCommunityCard({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="glass-panel rounded-xl p-6 md:p-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-left group"
      >
        <h2 className="font-headline-md text-headline-md text-on-background">Manage community</h2>
        <span
          className="material-symbols-outlined text-secondary transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          expand_more
        </span>
      </button>

      {open && <div className="flex flex-col gap-8 mt-8">{children}</div>}
    </section>
  );
}
