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
//   2. Create a new project        — a minimal inline name+description
//      form; on submit, creates the project then immediately saves into
//      it (createProjectAction returns the new id synchronously — no
//      extra round trip, no membership-row race, since
//      create_project_with_lead makes the caller a member atomically).
//   3. Just save it for me         — saveForMeAction, project_id NULL.
//
// REMEMBERS NOTHING: no localStorage, no "last used project" default, no
// preselection — every open starts from the same blank state, even when
// the viewer has exactly one project. That's deliberate, not a missing
// feature; asking every time is the point.
//
// Dialog shell copied from ResourcesSection.tsx's DeleteResourceConfirm —
// same fixed-overlay/role="dialog" idiom used everywhere else in this app
// for a modal, not a native confirm().

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createProjectAction } from "@/app/projects/actions";
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
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

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
        // the inbox badge / CommunitiesSection.
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

  const createAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !newName.trim() || !newDescription.trim()) return;

    setBusy(true);
    setOutcome(null);
    const created = await createProjectAction({ name: newName.trim(), description: newDescription.trim() });
    if (!created.ok) {
      setBusy(false);
      setOutcome({ ok: false, message: created.error });
      return;
    }
    const saved = await saveToProjectAction(created.id, item);
    setBusy(false);
    setOutcome(
      saved.ok
        ? { ok: true, message: `Created "${newName.trim()}" and saved it there.` }
        : { ok: false, message: saved.error }
    );
    if (saved.ok) router.refresh();
  };

  return (
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
        ) : creatingNew ? (
          <form onSubmit={createAndSave} className="flex flex-col gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              aria-label="New project name"
              autoFocus
              className="bg-surface-container-low border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What's this project about?"
              aria-label="New project description"
              rows={3}
              className="bg-surface-container-low border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreatingNew(false)}
                disabled={busy}
                className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy || !newName.trim() || !newDescription.trim()}
                className="btn-primary px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create & save"}
              </button>
            </div>
          </form>
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
    </div>
  );
}
