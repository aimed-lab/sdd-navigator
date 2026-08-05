"use client";

// Delete-project trigger + confirmation — same idiom as
// components/collaborate/DeletePostConfirm.tsx: a quiet text affordance
// (not a red button) that opens an overlay dialog naming what's actually
// being destroyed, rather than a bare "are you sure?".
//
// Only rendered for the lead (see app/projects/[id]/page.tsx) — that's a
// courtesy, not the gate. deleteProjectAction re-derives the caller from
// the session, and the "Projects: lead delete" RLS policy enforces
// is_project_lead() again in Postgres regardless of what this component
// renders or hides.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProjectAction } from "@/app/projects/[id]/actions";

export default function DeleteProjectButton({
  projectId,
  projectName,
  memberCount,
  proposalSubmitted,
}: {
  projectId: string;
  projectName: string;
  /** Total members, INCLUDING the lead — the dialog reports how many
   *  OTHERS lose access, so this gets -1'd below. */
  memberCount: number;
  /** Whether a SUBMITTED proposal is among what gets deleted — made
   *  prominent in the dialog when true, per spec: that's not the same
   *  stakes as deleting an empty or draft-only project. */
  proposalSubmitted: boolean;
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

    const res = await deleteProjectAction(projectId);
    if (res.ok) {
      router.push("/projects");
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
        className="font-label-sm text-label-sm text-secondary/60 hover:text-error transition-colors"
      >
        Delete project
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
            aria-label={`Delete ${projectName}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
          >
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-2xl text-error shrink-0">
                warning
              </span>
              <div className="min-w-0">
                <h2 className="font-headline-md text-headline-md text-on-background">
                  Delete this project?
                </h2>

                {proposalSubmitted && (
                  <p className="mt-2 font-body-md text-body-md text-error font-semibold">
                    This project has a SUBMITTED proposal. Deleting it permanently removes the
                    submitted proposal and its file.
                  </p>
                )}

                <p className="mt-2 font-body-md text-body-md text-secondary">
                  {otherMembers > 0 ? (
                    <>
                      {otherMembers} other {otherMembers === 1 ? "member" : "members"} will lose
                      access to this project.{" "}
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
                {deleting ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
