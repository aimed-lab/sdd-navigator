"use client";

// One section (note) of a wiki page, with the editing controls.
//
// Anyone who can edit the page (the server decides, see pageView's canEdit) sees
// "Edit": the section turns into a plain title box and a text box (markdown is
// fine) with Save and Cancel. Only the page owner sees "More (⋯)" with "Delete
// section". The read-only rendering (paragraphs, citations) is made on the
// server and passed in as `children`, so a visitor who cannot edit gets exactly
// the old markup. The server actions and RLS are the real gate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteNoteAction, editNoteAction } from "@/app/pages/[slug]/actions";
import MoreMenu from "@/components/MoreMenu";

export default function NoteSection({
  pageId,
  pageSlug,
  noteId,
  noteSlug,
  title,
  body,
  editedLabel,
  canEdit,
  isOwner,
  children,
}: {
  pageId: string;
  pageSlug: string;
  noteId: string;
  noteSlug: string;
  title: string;
  body: string;
  /** "Edited by Ada" etc., or null. */
  editedLabel: string | null;
  canEdit: boolean;
  isOwner: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [t, setT] = useState(title);
  const [b, setB] = useState(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await editNoteAction(pageId, pageSlug, noteId, t, b);
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await deleteNoteAction(pageId, pageSlug, noteId);
    setBusy(false);
    if (res.ok) {
      setConfirmDelete(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  if (editing) {
    return (
      <article id={`note-${noteSlug}`} className="scroll-mt-24">
        <form onSubmit={save} className="flex flex-col gap-3">
          <label className="sr-only" htmlFor={`nt-${noteId}`}>
            Section title
          </label>
          <input
            id={`nt-${noteId}`}
            value={t}
            onChange={(e) => setT(e.target.value)}
            maxLength={120}
            disabled={busy}
            className="w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-2 font-title text-[22px] text-on-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <label className="sr-only" htmlFor={`nb-${noteId}`}>
            Section text
          </label>
          <textarea
            id={`nb-${noteId}`}
            value={b}
            onChange={(e) => setB(e.target.value)}
            rows={Math.min(24, Math.max(8, b.split("\n").length + 2))}
            disabled={busy}
            className="w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <p className="font-body-sm text-body-sm text-secondary">
            Plain text or markdown. Write [[Another section title]] to link to a section on this page.
          </p>
          {error && (
            <p className="font-body-sm text-body-sm text-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60">
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setT(title);
                setB(body);
                setError(null);
              }}
              className="font-label-md text-label-md text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </form>
      </article>
    );
  }

  return (
    <article id={`note-${noteSlug}`} className="scroll-mt-24">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <h3 className="font-title text-[24px] leading-tight font-medium text-on-background">{title}</h3>
          {editedLabel && <span className="font-label-sm text-label-sm text-secondary">{editedLabel}</span>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg font-label-sm text-label-sm text-primary hover:bg-primary/5"
            >
              <span className="material-symbols-outlined text-base">edit</span>
              Edit
            </button>
            {isOwner && <MoreMenu items={[{ label: "Delete section", danger: true, onClick: () => setConfirmDelete(true) }]} />}
          </div>
        )}
      </div>
      {children}
      {error && !confirmDelete && (
        <p className="mt-2 font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => !busy && setConfirmDelete(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Delete ${title}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
          >
            <h2 className="font-headline-md text-headline-md text-on-background">Delete &ldquo;{title}&rdquo;?</h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">This can&apos;t be undone.</p>
            {error && (
              <p className="mt-3 font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
                className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Delete section"}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
