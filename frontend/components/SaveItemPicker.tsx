"use client";

// The "where do you want to save this?" dialog — opened by ItemCard's
// bookmark via `onSaveClick` when there's no single obvious save target
// (today: only the community feed, see components/communities/
// ResourcesSection.tsx). Three choices, per spec:
//
//   1. Save to one of my projects  — lists projects the viewer is a
//      member of (fetched from /api/projects/mine); picking one calls the
//      SAME saveToProjectAction ItemCard itself would call with a fixed
//      projectId.
//   2. Create a new project        — renders the REAL
//      components/projects/CreateProjectForm.tsx (same fields, same
//      validation, same behavior as /projects/new), not a second
//      hand-rolled form that would drift from it. That component takes
//      `onCreated`/`onCancel` overrides specifically so a dialog can embed
//      it without the page-only navigate-away-on-success / Cancel-link-to-
//      /projects behavior — see its own top comment. `onCreated` fires
//      with the new project's id (createProjectAction already returns it
//      synchronously — no extra round trip, no membership-row race, since
//      create_project_with_lead makes the caller a member atomically),
//      which this component then saves the item into.
//   3. Just save it for me         — saveForMeAction, project_id NULL.
//
// REMEMBERS NOTHING: no localStorage, no "last used project" default, no
// preselection — every open starts from the same blank state, even when
// the viewer has exactly one project. That's deliberate, not a missing
// feature; asking every time is the point.
//
// Dialog shell copied from ResourcesSection.tsx's DeleteResourceConfirm /
// LeaveButton's LeaveConfirm — same fixed-overlay/role="dialog" idiom (NOT
// a new one) used everywhere else in this app for a modal, not a native
// confirm(): `fixed inset-0 z-[60] flex items-center justify-center
// bg-on-background/40 backdrop-blur-sm`.
//
// PORTALED TO document.body, unlike those two — this is the one thing that
// actually differs, and it's load-bearing, not stylistic. This picker is
// opened from inside CollapsibleSection's `.glass-panel` wrapper
// (ResourcesSection -> CollapsibleSection), and `.glass-panel` sets
// `backdrop-filter: blur(12px)` (app/globals.css). Per the CSS spec, an
// element with `backdrop-filter` becomes the CONTAINING BLOCK for any
// `position: fixed` descendant — so without the portal, this dialog's
// "fixed inset-0" was computing relative to that glass-panel `<section>`'s
// box, not the viewport: a backdrop sized to the Resources card instead of
// the screen, with the dialog itself rendering wherever that card happened
// to scroll to on a long page. Verified in the browser (getComputedStyle +
// getBoundingClientRect), not by re-reading the CSS — a shrunk-to-card
// backdrop rect was the actual measured symptom.
// LeaveButton/DeleteCommunityButton never hit this: they mount inside
// ManageCommunityCard, which is deliberately "no glass" (plain
// bg-surface-container-low, see that component's own comment) — no
// backdrop-filter ancestor, so their identical fixed/z-[60] classes land
// on the viewport correctly without needing a portal. Same visual pattern,
// different mount point is the fix, not a new pattern.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import CreateProjectForm from "@/components/projects/CreateProjectForm";
import { saveForMeAction, saveToProjectAction } from "@/app/explore/actions";
import type { ExploreItem } from "@/types/explore";

type MyProject = { id: string; name: string };

type Outcome = { ok: true; message: string } | { ok: false; message: string };

export default function SaveItemPicker({
  item,
  onClose,
}: {
  item: ExploreItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<MyProject[] | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // document.body doesn't exist during SSR — this flips true only after
  // the client mounts, same guard every createPortal-to-body needs.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects/mine", { cache: "no-store" });
        const json = (await res.json()) as { projects?: MyProject[] };
        if (!cancelled) setProjects(json.projects ?? []);
      } catch {
        // A failed list just means "Save to one of my projects" shows
        // none — same "never break a widget's host over a fetch" rule as
        // the inbox badge / CommunitiesResultsSection.
        if (!cancelled) setProjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveToProject = async (projectId: string, projectName: string) => {
    setBusy(true);
    setOutcome(null);
    const res = await saveToProjectAction(projectId, item);
    setBusy(false);
    setOutcome(
      res.ok
        ? { ok: true, message: `Saved to ${projectName}.` }
        : { ok: false, message: res.error }
    );
    if (res.ok) router.refresh();
  };

  const saveForMe = async () => {
    setBusy(true);
    setOutcome(null);
    const res = await saveForMeAction(item);
    setBusy(false);
    setOutcome(
      res.ok ? { ok: true, message: "Saved to your saved items." } : { ok: false, message: res.error }
    );
    if (res.ok) router.refresh();
  };

  // CreateProjectForm's own onCreated override (see its top comment) —
  // called with the new project's id once IT has already handled
  // creation/validation/errors; this only does the "and save the item
  // there" half.
  const handleProjectCreated = async (projectId: string) => {
    setBusy(true);
    setOutcome(null);
    const saved = await saveToProjectAction(projectId, item);
    setBusy(false);
    setCreatingNew(false);
    setOutcome(
      saved.ok
        ? { ok: true, message: "Created your project and saved it there." }
        : { ok: false, message: saved.error }
    );
    if (saved.ok) router.refresh();
  };

  if (!mounted) return null;

  // "Create a new project" renders the REAL CreateProjectForm as the
  // dialog's entire visible surface (its own glass-card IS the modal
  // content here) rather than nesting it inside this component's own
  // white card — that form already brings its own chrome, and doubling up
  // two nested card surfaces would look like a mistake, not a design.
  // Wider than the picker's own max-w-md: CreateProjectForm has more
  // fields (programme details, challenge) than the compact menu below and
  // sets its own max-w-[600px] internally — this just gives it the room
  // to use that, scrolling if the viewport is short.
  if (creatingNew && !outcome) {
    return createPortal(
      <div
        className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-on-background/40 backdrop-blur-sm overflow-y-auto p-4"
        onClick={() => !busy && onClose()}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Create a project to save "${item.title}" into`}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-2xl my-8"
        >
          <CreateProjectForm
            colabofest={false}
            onCreated={handleProjectCreated}
            onCancel={() => setCreatingNew(false)}
          />
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Save "${item.title}"`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
      >
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background">Save this item</h2>
          <p className="mt-1 font-body-sm text-body-sm text-secondary truncate">{item.title}</p>
        </div>

        {outcome ? (
          <>
            <p
              className={
                "font-body-md text-body-md " + (outcome.ok ? "text-primary" : "text-error")
              }
              role={outcome.ok ? undefined : "alert"}
            >
              {outcome.message}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-label-sm text-label-sm text-secondary/70 uppercase mb-2">
                Save to one of my projects
              </p>
              {projects === null ? (
                <p className="font-body-sm text-body-sm text-secondary">Loading your projects…</p>
              ) : projects.length === 0 ? (
                <p className="font-body-sm text-body-sm text-secondary">
                  You&apos;re not a member of any projects yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveToProject(p.id, p.name)}
                        className="w-full text-left px-4 py-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-background font-body-md text-body-md truncate disabled:opacity-50"
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => setCreatingNew(true)}
              className="w-full text-left px-4 py-2.5 rounded-lg border border-outline-variant/40 hover:bg-surface-container-low text-on-background font-body-md text-body-md flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Create a new project and save it there
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={saveForMe}
              className="w-full text-left px-4 py-2.5 rounded-lg border border-outline-variant/40 hover:bg-surface-container-low text-on-background font-body-md text-body-md disabled:opacity-50"
            >
              {busy ? "Saving…" : "Just save it for me, not tied to any project"}
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="self-end font-label-sm text-label-sm text-secondary hover:text-primary transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
