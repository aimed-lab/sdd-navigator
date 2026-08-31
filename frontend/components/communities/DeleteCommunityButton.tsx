"use client";

// Delete-community trigger + confirmation — same dialog markup as
// components/projects/DeleteProjectButton.tsx, naming what's actually
// being destroyed rather than a bare "are you sure?". Unlike that one, the
// TRIGGER itself is plainly red (text-error, not the quiet
// text-secondary/60 hover:text-error idiom DeleteProjectButton and every
// other "Leave"/"Withdraw" control here use) — a request to make this one
// read as destructive at a glance, not only on hover. Uses the same
// text-error / bg-error / text-on-error design tokens the confirm
// dialog's own destructive button already used, not a hardcoded hex.
//
// Only rendered for an admin (see app/communities/[slug]/page.tsx) — that's
// a courtesy, not the gate. deleteCommunityAction re-derives the caller
// from the session, and "Communities: admin delete" (RLS) enforces
// is_community_admin() again in Postgres regardless of what this component
// renders or hides.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteCommunityAction } from "@/app/communities/actions";

export default function DeleteCommunityButton({
  communityId,
  communityName,
  memberCount,
  projectCount,
}: {
  communityId: string;
  communityName: string;
  /** Total ACTIVE members, including the admin deleting it — the dialog
   *  reports how many OTHERS lose access, so this gets -1'd below. */
  memberCount: number;
  /** How many projects currently belong to this community — made
   *  prominent in the dialog: they survive (community_id set back to
   *  null), but that's worth saying explicitly rather than leaving
   *  "this can't be undone" to imply they're deleted too. */
  projectCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherMembers = Math.max(0, memberCount - 1);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);

    const res = await deleteCommunityAction(communityId);
    if (res.ok) {
      router.push("/communities");
      router.refresh();
    } else {
      setError(res.error);
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-label-sm text-label-sm text-error hover:opacity-80 transition-opacity"
      >
        Delete community
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => !deleting && setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Delete ${communityName}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
          >
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-2xl text-error shrink-0">
                warning
              </span>
              <div className="min-w-0">
                <h2 className="font-headline-md text-headline-md text-on-background">
                  Delete this community?
                </h2>

                {projectCount > 0 && (
                  <p className="mt-2 font-body-md text-body-md text-secondary">
                    {projectCount} {projectCount === 1 ? "project" : "projects"} in this community
                    will NOT be deleted — {projectCount === 1 ? "it" : "they"} become standalone
                    personal {projectCount === 1 ? "project" : "projects"}.
                  </p>
                )}

                <p className="mt-2 font-body-md text-body-md text-secondary">
                  {otherMembers > 0 ? (
                    <>
                      {otherMembers} other {otherMembers === 1 ? "member" : "members"} will lose
                      access to this community.{" "}
                    </>
                  ) : null}
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
                onClick={() => setOpen(false)}
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
                {deleting ? "Deleting…" : "Delete community"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
