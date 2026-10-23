"use client";

// Owner-only controls on a wiki page: visibility (with a confirm before
// making a page Public), "Keep this page updated", and deleting the page.
//
// Rendered only for the owner (app/pages/[slug]/page.tsx) as a convenience;
// the server actions re-derive the caller from the session and the pages RLS
// policies are the real gate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deletePageAction,
  setRefreshEnabledAction,
  setVisibilityAction,
} from "@/app/pages/[slug]/actions";
import MoreMenu from "@/components/MoreMenu";
import { VISIBILITY_INFO, type PageVisibility } from "@/lib/server/pages/pageViewHelpers";

const OPTIONS: PageVisibility[] = ["private", "team", "public"];

function Dialog({
  title,
  body,
  confirmLabel,
  busy,
  error,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <h2 className="font-headline-md text-headline-md text-on-background">{title}</h2>
        <p className="mt-2 font-body-md text-body-md text-secondary">{body}</p>
        {error && (
          <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              "px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 " +
              (danger ? "text-on-error bg-error" : "btn-primary")
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PageControls({
  pageId,
  slug,
  title,
  visibility,
  refreshEnabled,
  projectName,
}: {
  /** Set for a project page: the page is shared with the whole project, so the
   *  visibility, update and team boxes give way to one line and a More menu. */
  projectName?: string;
  pageId: string;
  slug: string;
  title: string;
  visibility: PageVisibility;
  refreshEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const changeVisibility = async (next: PageVisibility) => {
    if (busy || next === visibility) return;
    setBusy(true);
    setError(null);
    const res = await setVisibilityAction(pageId, slug, next);
    setBusy(false);
    setConfirmPublic(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  const toggleRefresh = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await setRefreshEnabledAction(pageId, slug, !refreshEnabled);
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await deletePageAction(pageId);
    if (res.ok) {
      router.push("/pages?deleted=1");
      router.refresh();
    } else {
      setBusy(false);
      setError(res.error);
    }
  };

  if (projectName) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3" aria-label="Page settings">
        <p className="font-body-md text-body-md text-secondary">Shared with everyone on {projectName}.</p>
        <MoreMenu items={[{ label: "Delete wiki page", danger: true, onClick: () => setConfirmDelete(true) }]} />
        {confirmDelete && (
          <Dialog
            title={`Delete "${title}"?`}
            body="Its notes, sources and update history will be removed. This can't be undone."
            confirmLabel="Delete wiki page"
            busy={busy}
            error={error}
            danger
            onCancel={() => setConfirmDelete(false)}
            onConfirm={remove}
          />
        )}
      </section>
    );
  }

  return (
    <section className="glass-panel rounded-2xl p-6 flex flex-col gap-6" aria-label="Page settings">
      <div>
        <h2 className="font-label-md text-label-md text-on-background">Who can see this wiki page</h2>
        <div role="radiogroup" aria-label="Visibility" className="mt-3 flex flex-wrap gap-2">
          {OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={v === visibility}
              disabled={busy}
              onClick={() => (v === "public" && visibility !== "public" ? setConfirmPublic(true) : changeVisibility(v))}
              className={
                "px-4 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50 " +
                (v === visibility ? "btn-primary" : "btn-outline")
              }
            >
              {VISIBILITY_INFO[v].label}
            </button>
          ))}
        </div>
        <p className="mt-2 font-body-sm text-body-sm text-secondary">{VISIBILITY_INFO[visibility].line}</p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-label-md text-label-md text-on-background">Keep this page updated</h2>
          <p className="mt-1 font-body-sm text-body-sm text-secondary">
            About once a day, new papers, trials, approvals and more are added to What&apos;s new.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={refreshEnabled}
          aria-label="Keep this page updated"
          disabled={busy}
          onClick={toggleRefresh}
          className={
            "relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 " +
            (refreshEnabled ? "bg-primary" : "bg-outline-variant")
          }
        >
          <span
            className={
              "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform " +
              (refreshEnabled ? "translate-x-5" : "")
            }
          />
        </button>
      </div>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div>
        <MoreMenu
          up
          className="-ml-2"
          items={[{ label: "Delete wiki page", danger: true, onClick: () => setConfirmDelete(true) }]}
        />
      </div>

      {confirmPublic && (
        <Dialog
          title="Make this page public?"
          body="Anyone with the link will be able to read it, including people who are not signed in. You can switch it back later, but anything already seen stays seen."
          confirmLabel="Make public"
          busy={busy}
          error={error}
          onCancel={() => setConfirmPublic(false)}
          onConfirm={() => changeVisibility("public")}
        />
      )}
      {confirmDelete && (
        <Dialog
          title={`Delete "${title}"?`}
          body="Its notes, sources and update history will be removed, and team members lose access. This can't be undone."
          confirmLabel="Delete wiki page"
          busy={busy}
          error={error}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </section>
  );
}
