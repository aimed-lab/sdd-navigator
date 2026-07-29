"use client";

// Delete confirmation for a Promote showcase entry — same dialog idiom as
// collaborate/DeletePostConfirm.tsx (overlay + role="dialog", Esc to close,
// focus on open).
//
// Unlike collab_posts, nothing has a foreign key onto promote_showcase — no
// connection_requests-style cascade, no other user's data at stake. So this
// stays a plain confirmation rather than naming a response count that
// doesn't exist here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteShowcaseAction } from "@/app/promote/actions";

export default function DeleteShowcaseConfirm({
  entryId,
  entryTitle,
  onClose,
}: {
  entryId: string;
  entryTitle: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);

    const res = await deleteShowcaseAction(entryId);
    if (res.ok) {
      onClose();
      router.refresh();
    } else {
      setError(res.error);
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${entryTitle}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl outline-none p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">
            warning
          </span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Delete this entry?
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              This can&apos;t be undone.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting}
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
