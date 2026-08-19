"use client";

// Checklist section — frontend/design/projects/STRUCTURE.md, detail
// workspace, "Checklist". ANY member may add/edit/reorder/change status/
// delete — nothing here is lead-gated, unlike Team and Proposal. RLS
// ("Checklist items: member *", 2026-08-04_projects.sql) is the real gate;
// this component doesn't hide any control based on role.
//
// STATUS CHANGES FEEL INSTANT: clicking a segmented-control button updates
// local state immediately (optimistic), then calls the server action.
// Failure reverts the local state AND shows a visible inline error — never
// a silent revert, per STRUCTURE.md's own requirement.
//
// THE BRIDGE: "Ask for help" is a plain Link to /collaborate/new with query
// params (see app/collaborate/new/page.tsx) — the item's own label seeds
// BOTH the title ("Help needed: <item>", so a board reader immediately
// reads it as a request, not a task) and "needs" (the item text alone), and
// the item's id rides along as checklist_item_id so the new post links
// back. The description is seeded from buildProjectContextLine — the
// project's SHORT structured fields (target/indication/modality/stage)
// ONLY, never the free-text project description. That description can (and
// in real projects does) hold unpublished internal strategy; a public
// board post must never volunteer it just because the user clicked a small
// text link. The user can still type whatever detail they choose — this
// only changes what's pre-filled for them, not what they're allowed to say.
// Once collab_post_id is set (resolved server-side in getProject(), via a
// plain query on collab_posts.checklist_item_id + the existing
// collab_post_interest_counts RPC — no new function), the row shows
// "Posted to Collaborate · N responses" instead of/alongside "Ask for
// help". There's no single-post detail page anywhere in this app yet, so
// that line links to the board itself (/collaborate), not a specific post.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addChecklistItemAction,
  deleteChecklistItemAction,
  moveChecklistItemAction,
  updateChecklistLabelAction,
  updateChecklistStatusAction,
} from "@/app/projects/[id]/actions";
import type { ChecklistItem, ChecklistStatus } from "@/lib/server/projects";
import { buildProjectContextLine } from "@/lib/projectTypes";
import ServiceProvidersSection, {
  type SelectedServiceItem,
} from "@/components/projects/ServiceProvidersSection";

const STATUS_OPTIONS: { value: ChecklistStatus; label: string }[] = [
  { value: "not_yet", label: "Not yet" },
  { value: "in_progress", label: "In progress" },
  { value: "ready", label: "Ready" },
];

function StatusControl({
  status,
  onChange,
  disabled,
}: {
  status: ChecklistStatus;
  onChange: (next: ChecklistStatus) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex bg-surface-container rounded-lg p-1 w-fit shrink-0">
      {STATUS_OPTIONS.map((opt) => {
        const active = opt.value === status;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => !active && onChange(opt.value)}
            className={
              "px-3 py-1.5 rounded-md font-label-sm text-label-sm transition-colors flex items-center gap-1 disabled:opacity-50 " +
              (active
                ? "bg-surface-container-lowest text-primary shadow-sm border border-outline-variant/20"
                : "text-secondary hover:text-on-background")
            }
          >
            {active && opt.value === "ready" && (
              <span className="material-symbols-outlined text-[14px]">check</span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function DeleteItemConfirm({
  label,
  onCancel,
  onConfirm,
  deleting,
  error,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${label}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <h2 className="font-headline-md text-headline-md text-on-background">Delete this item?</h2>
        <p className="mt-2 font-body-md text-body-md text-secondary">
          &ldquo;{label}&rdquo; will be removed from the checklist. This can&apos;t be undone.
        </p>
        {error && (
          <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete item"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChecklistSection({
  projectId,
  projectTarget,
  projectIndication,
  projectModality,
  projectStage,
  items,
  isColabofest,
}: {
  projectId: string;
  projectTarget: string | null;
  projectIndication: string | null;
  projectModality: string | null;
  projectStage: string | null;
  items: ChecklistItem[];
  isColabofest?: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState<ChecklistItem[]>(items);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [confirmTarget, setConfirmTarget] = useState<ChecklistItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // ONE action per item (see the module-level rule below): the currently
  // selected item for the shared Service providers section further down
  // the page — never an inline per-item panel. Selecting a different item
  // re-targets the same section rather than opening a second one.
  const [selectedServiceItem, setSelectedServiceItem] = useState<SelectedServiceItem | null>(
    null
  );

  const setBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const changeStatus = async (item: ChecklistItem, next: ChecklistStatus) => {
    const previous = item.status;
    // Optimistic — feels instant.
    setList((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)));
    setRowErrors((prev) => {
      const { [item.id]: _drop, ...rest } = prev;
      return rest;
    });
    setBusy(item.id, true);

    const res = await updateChecklistStatusAction(projectId, item.id, next);
    setBusy(item.id, false);

    if (!res.ok) {
      // Revert — and the failure is VISIBLE, not silent.
      setList((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: previous } : i)));
      setRowErrors((prev) => ({ ...prev, [item.id]: res.error }));
    }
  };

  const move = async (item: ChecklistItem, direction: "up" | "down") => {
    setBusy(item.id, true);
    const res = await moveChecklistItemAction(projectId, item.id, direction);
    setBusy(item.id, false);
    if (res.ok) {
      router.refresh();
    } else {
      setRowErrors((prev) => ({ ...prev, [item.id]: res.error }));
    }
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adding || !draft.trim()) return;
    setAdding(true);
    setAddError(null);

    const res = await addChecklistItemAction(projectId, draft);
    if (res.ok) {
      setList((prev) => [...prev, res.item]);
      setDraft("");
    } else {
      setAddError(res.error);
    }
    setAdding(false);
  };

  const confirmDelete = async () => {
    if (!confirmTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);

    const res = await deleteChecklistItemAction(projectId, confirmTarget.id);
    if (res.ok) {
      setList((prev) => prev.filter((i) => i.id !== confirmTarget.id));
      setConfirmTarget(null);
    } else {
      setDeleteError(res.error);
    }
    setDeleting(false);
  };

  const startEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setEditDraft(item.label);
  };

  const saveEdit = async (item: ChecklistItem) => {
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === item.label) {
      setEditingId(null);
      return;
    }
    const previous = item.label;
    setList((prev) => prev.map((i) => (i.id === item.id ? { ...i, label: trimmed } : i)));
    setEditingId(null);
    setBusy(item.id, true);

    const res = await updateChecklistLabelAction(projectId, item.id, trimmed);
    setBusy(item.id, false);

    if (res.ok) {
      // The rename may have changed which action this item shows (a
      // re-worded item can start or stop matching a service capability) —
      // apply the freshly re-classified result rather than keeping the
      // stale value from before the edit.
      setList((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, matched_capabilities: res.matched_capabilities } : i
        )
      );
    } else {
      setList((prev) => prev.map((i) => (i.id === item.id ? { ...i, label: previous } : i)));
      setRowErrors((prev) => ({ ...prev, [item.id]: res.error }));
    }
  };

  const askForHelpHref = (item: ChecklistItem) => {
    const contextLine = buildProjectContextLine({
      target: projectTarget,
      indication: projectIndication,
      modality: projectModality,
      stage: projectStage,
    });
    const params = new URLSearchParams({
      checklist_item_id: item.id,
      project_id: projectId,
      // Reads as a REQUEST, not an internal task — a board reader should
      // immediately understand someone is asking for help, not looking at
      // a to-do list entry.
      title: `Help needed: ${item.label}`,
      description: contextLine,
      need: item.label,
    });
    return `/collaborate/new?${params.toString()}`;
  };

  return (
    <>
    <section className="mb-20">
      <h2
        className={
          "font-headline-md text-headline-md text-on-background " +
          (isColabofest ? "mb-2" : "mb-8")
        }
      >
        Checklist
      </h2>

      {isColabofest && (
        <p className="font-body-sm text-body-sm text-secondary mb-8">
          {list.length > 0
            ? "Section A essentials are pre-filled below."
            : "Add Section A's essentials below to get started."}{" "}
          <a
            href="/colabofest-readiness-checklist.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            See the full readiness checklist (PDF)
          </a>{" "}
          for sections B–H.
        </p>
      )}

      {list.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary mb-6">No checklist items yet.</p>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm">
          {list.map((item, idx) => {
            const busy = busyIds.has(item.id);
            const ready = item.status === "ready";
            return (
              <div
                key={item.id}
                className={
                  "flex flex-col md:flex-row md:items-start gap-4 p-6 hover:bg-surface-container-low/30 transition-colors" +
                  (idx < list.length - 1 ? " border-b border-outline-variant/20" : "")
                }
              >
                <StatusControl
                  status={item.status}
                  disabled={busy}
                  onChange={(next) => changeStatus(item, next)}
                />

                <div className="flex-1 min-w-0">
                  {editingId === item.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={() => saveEdit(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEdit(item);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                      className="w-full bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-1.5 font-body-md text-body-md text-on-background outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className={
                        "text-left font-body-md hover:text-primary transition-colors " +
                        (ready ? "line-through opacity-60 text-on-background" : "font-medium text-on-background")
                      }
                    >
                      {item.label}
                    </button>
                  )}

                  {item.collab_post_id && (
                    <Link
                      href="/collaborate"
                      className="font-body-sm text-body-sm text-secondary mt-1 hover:text-primary hover:underline underline-offset-4 inline-block"
                    >
                      Posted to Collaborate · {item.collab_post_responses}{" "}
                      {item.collab_post_responses === 1 ? "response" : "responses"}
                    </Link>
                  )}

                  {rowErrors[item.id] && (
                    <p className="mt-1 font-body-sm text-body-sm text-error" role="alert">
                      {rowErrors[item.id]}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* ONE action per item, chosen by what it actually needs —
                      never both. matched_capabilities is the STORED result
                      of classifying this item's label against the provider
                      catalog's vocabulary (computed once at add/edit time,
                      see lib/server/checklistClassify.ts): non-empty means
                      this item needs a SERVICE (something you'd buy from a
                      provider) → "Find a service provider"; empty — either
                      because it needs a PERSON/internal task, or because
                      classification hasn't run or failed (the safe
                      fallback) — → "Ask for help". */}
                  {!ready && item.matched_capabilities.length > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedServiceItem({
                          id: item.id,
                          label: item.label,
                          matchedCapabilities: item.matched_capabilities,
                          askForHelpHref: askForHelpHref(item),
                        })
                      }
                      className="font-label-sm text-label-sm text-primary hover:underline"
                    >
                      Find a service provider
                    </button>
                  ) : (
                    !ready && (
                      <Link
                        href={askForHelpHref(item)}
                        className="font-label-sm text-label-sm text-primary hover:underline"
                      >
                        Ask for help
                      </Link>
                    )
                  )}
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(item, "up")}
                      disabled={idx === 0 || busy}
                      aria-label="Move up"
                      className="text-secondary hover:text-primary disabled:opacity-30 disabled:hover:text-secondary"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_drop_up</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => move(item, "down")}
                      disabled={idx === list.length - 1 || busy}
                      aria-label="Move down"
                      className="text-secondary hover:text-primary disabled:opacity-30 disabled:hover:text-secondary -mt-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_drop_down</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmTarget(item);
                    }}
                    aria-label="Delete item"
                    className="text-secondary hover:text-error"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form
        onSubmit={submitAdd}
        className="mt-4 p-4 flex items-center gap-4 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a checklist item…"
          aria-label="New checklist item"
          className="flex-1 bg-transparent border-none focus:ring-0 p-0 font-body-md text-body-md text-on-background placeholder:text-secondary/60 outline-none min-w-0"
        />
        <button
          type="submit"
          disabled={adding}
          className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md flex items-center gap-2 shrink-0 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          {adding ? "Adding…" : "Add item"}
        </button>
      </form>
      {addError && (
        <p className="font-body-sm text-body-sm text-error mt-1" role="alert">
          {addError}
        </p>
      )}

      {confirmTarget && (
        <DeleteItemConfirm
          label={confirmTarget.label}
          deleting={deleting}
          error={deleteError}
          onCancel={() => {
            setConfirmTarget(null);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
        />
      )}
    </section>

    {/* Dedicated, page-level results section — see ServiceProvidersSection's
        own docstring for why this is one shared section, not a per-item
        inline panel: only one item's results ever show at a time, and
        clicking "Find a service provider" smooth-scrolls here rather than
        expanding anything in place. */}
    <ServiceProvidersSection projectId={projectId} selectedItem={selectedServiceItem} />
    </>
  );
}
