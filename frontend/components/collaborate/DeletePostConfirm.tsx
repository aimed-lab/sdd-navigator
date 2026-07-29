"use client";

// Delete confirmation for a Collaborate post — same dialog idiom as
// ConnectModal (overlay + role="dialog", Esc to close, focus on open).
//
// connection_requests.post_id is ON DELETE CASCADE (database/schema.sql), so
// deleting a post silently destroys every response to it too, including
// responders' self-provided contact details. That's the whole reason this is
// a real confirmation and not a bare "are you sure": the message has to name
// the actual number of responses at stake, or a post owner has no way to
// know deleting it also erases other people's data, not just their own post.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deletePostAction } from "@/app/collaborate/actions";

export default function DeletePostConfirm({
  postId,
  postTitle,
  interested,
  onClose,
}: {
  postId: string;
  postTitle: string;
  /** post.interested — how many distinct people responded. Drives the
   *  wording: a real warning when there's something to lose, a plain
   *  confirmation when there isn't. */
  interested: number;
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

    const res = await deletePostAction(postId);
    if (res.ok) {
      // Still on /collaborate (this isn't a navigation) — revalidatePath on
      // the server marks the board's cache stale, but the already-mounted
      // page needs this explicit refresh to actually re-render with the
      // post gone. Same precedent as CreatePostForm's post-submit refresh.
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
        aria-label={`Delete ${postTitle}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl outline-none p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">
            warning
          </span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Delete this post?
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              {interested > 0 ? (
                <>
                  {interested} {interested === 1 ? "person" : "people"} responded to this
                  post. Deleting it also removes {interested === 1 ? "their response" : "their responses"}{" "}
                  and their contact details. This can&apos;t be undone.
                </>
              ) : (
                <>This can&apos;t be undone.</>
              )}
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
            {deleting ? "Deleting…" : "Delete post"}
          </button>
        </div>
      </div>
    </div>
  );
}
