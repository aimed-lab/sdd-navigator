"use client";

// "Project workspace" on /phgdh: the three access levels, side by side. No logins
// or roles exist yet, so this is the visible structure for the demo:
//   PUBLIC  real content (abstracts and the app screenshot from
//           lib/phgdhMaterials.ts); a tile that has no content yet is not rendered
//   TEAM    a locked preview, no data, not clickable
//   ADMIN   a locked preview, no data, not clickable
// Locked tiles link nowhere.

import { useEffect, useRef, useState } from "react";
import SectionHeading from "@/components/explore/SectionHeading";
import {
  abstractReady,
  appScreenshot,
  manuscriptAbstract,
  patentAbstract,
  type Abstract,
} from "@/lib/phgdhMaterials";
import { TYPE_STYLES } from "@/lib/typeStyles";

function LevelLabel({ children, locked }: { children: React.ReactNode; locked?: boolean }) {
  return (
    <p className="type-label flex items-center gap-1.5 mb-3 h-5 text-secondary">
      {locked && <span className="material-symbols-outlined text-[16px] leading-none">lock</span>}
      {children}
    </p>
  );
}

// An abstract: title, the text clamped to 6 lines, and "Read more" that expands
// it in place. "Read more" only appears when the text is actually cut off.
function AbstractTile({ kind, abstract }: { kind: string; abstract: Abstract }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const t = TYPE_STYLES.paper;

  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [abstract.text, expanded]);

  return (
    <div className="tile p-5" style={{ background: t.bg }}>
      <p className="type-label" style={{ color: t.fg }}>
        {kind}
      </p>
      <h3 className="mt-2 font-title text-[20px] leading-tight font-medium text-on-background">
        {abstract.title}
      </h3>
      {abstract.note && <p className="mt-1 text-xs text-on-background/55">{abstract.note}</p>}
      <p
        ref={ref}
        className={`mt-2 text-[14px] leading-relaxed text-on-background/75 whitespace-pre-line ${
          expanded ? "" : "line-clamp-6"
        }`}
      >
        {abstract.text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="mt-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

// The app screenshot: a rounded image, click for a larger view in a simple
// lightbox. Not rendered unless the file actually loads.
function ScreenshotTile() {
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setStatus("ok");
    img.onerror = () => setStatus("missing");
    img.src = appScreenshot;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (status !== "ok") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View the app screenshot larger"
        className="tile block w-full overflow-hidden bg-white cursor-zoom-in"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={appScreenshot} alt="Screenshot of the PHGDH app" className="w-full h-auto block" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="App screenshot"
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4 md:p-10"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 flex items-center justify-center"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={appScreenshot}
            alt="Screenshot of the PHGDH app"
            className="max-w-full max-h-full rounded-[14px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// A locked preview: muted, not clickable, links nowhere.
function LockedTile({ items, note }: { items: string; note: string }) {
  return (
    <div
      aria-disabled="true"
      className="rounded-[14px] p-5 select-none"
      style={{ background: "var(--type-other-bg)" }}
    >
      <p className="font-title text-[18px] leading-snug font-medium text-on-background/55">
        {items}
      </p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-on-background/50">
        <span className="material-symbols-outlined text-[16px] leading-none">lock</span>
        {note}
      </p>
    </div>
  );
}

export default function ProjectWorkspace() {
  const showPatent = abstractReady(patentAbstract);
  const showManuscript = abstractReady(manuscriptAbstract);

  return (
    <section>
      <SectionHeading
        title="Project workspace"
        subtitle="Three access levels: what's shared publicly, what the team sees, and what admins manage."
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* PUBLIC (open) */}
        <div>
          <LevelLabel>Public · open</LevelLabel>
          <div className="space-y-4">
            {showPatent && <AbstractTile kind="Patent abstract" abstract={patentAbstract} />}
            {showManuscript && (
              <AbstractTile kind="Manuscript abstract" abstract={manuscriptAbstract} />
            )}
            <ScreenshotTile />
            <p className="text-sm text-secondary">
              Plus the public papers, datasets, trials and news below.
            </p>
          </div>
        </div>

        {/* TEAM (locked) */}
        <div>
          <LevelLabel locked>Team</LevelLabel>
          <LockedTile
            items="Full patent · Full manuscript · Code repository · Team AI assistant"
            note="Team access only"
          />
        </div>

        {/* ADMIN (locked) */}
        <div>
          <LevelLabel locked>Admin</LevelLabel>
          <LockedTile
            items="Raw data · Versioned documents · Permissions and views · Admin AI assistant"
            note="Admin only"
          />
        </div>
      </div>
    </section>
  );
}
