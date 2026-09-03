"use client";

// Same disclosure idiom as ManageCommunityCard (a full-width header row,
// expand_more icon rotating open/closed) — reused here for every section on
// the community page, not just Manage community. Wrapped in `glass-panel`
// (the same static-card surface every content card in this app already
// uses — CommunityProjectsList's own project cards, MembersSection's member
// cards, etc.) so a section reads as a card the moment it lands on the
// page, not just once expanded. ManageCommunityCard is intentionally on a
// QUIETER surface than this (bg-surface-container-low, no glass) — it's
// admin tooling, not the community's content, and shouldn't visually
// outrank every section here the way it used to as the only carded thing on
// the page.
//
// `defaultOpen` sets the initial state per section (Projects starts open,
// everything else starts closed); it's read only once via useState's
// initializer, same as ManageCommunityCard's own `open` state — a section
// doesn't re-collapse itself if its data changes underneath it.
//
// `count`, when given, renders as a small muted pill after the title
// ("Members [11]") — the same rounded-full/bg-surface-container-low/
// text-secondary pill used everywhere else in this app for a count or tag
// (PostCard's stage pill, ProjectCard's pills, JoinLeaveControl's "Member"
// pill) — so a COLLAPSED section still tells the reader something instead
// of just a bare title.
//
// `action`, when given, renders between the count and the chevron, but only
// while the section is OPEN — the caller decides whether the viewer is
// allowed to see it at all (e.g. isAdmin) before ever passing it in; this
// component only enforces "never show it on a collapsed section" so an
// action never floats on its own row below a closed header.

import { useState } from "react";

export default function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);

  return (
    <section className="glass-panel rounded-xl p-6 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-3 min-w-0 text-left"
        >
          <h2 className="font-headline-md text-headline-md text-on-background truncate">
            {title}
          </h2>
          {typeof count === "number" && (
            <span className="shrink-0 px-2 py-0.5 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm">
              {count}
            </span>
          )}
        </button>

        <div className="flex items-center gap-3 shrink-0">
          {open && action}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            className="text-secondary"
          >
            <span
              className="material-symbols-outlined block transition-transform duration-300"
              style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              expand_more
            </span>
          </button>
        </div>
      </div>

      {open && <div className="mt-6">{children}</div>}
    </section>
  );
}
