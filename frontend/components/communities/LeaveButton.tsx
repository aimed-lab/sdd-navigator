"use client";

// The "Leave" trigger + its confirmation dialog, factored out of
// JoinLeaveControl so it can render in TWO different places on the same
// page: next to the Admin/Lead/Member badge in the header for a non-admin
// active member (JoinLeaveControl still does that), and — for an admin —
// at the bottom of the "Manage community" card next to Delete community
// instead (app/communities/[slug]/page.tsx), since that corner was
// stacking too many controls. Either way it's the SAME component with the
// SAME behavior; only where it's mounted differs.
//
// LAST-ADMIN MESSAGE TIMING: the control itself is always a normal,
// enabled "Leave" — isLastAdmin changes nothing about how it looks before
// a click. Only on click does it matter: a last admin gets a notice
// dialog explaining why they can't leave instead of the normal confirm
// dialog. enforce_community_admin_guard (the trigger) is still the actual
// backstop if this is ever bypassed — this is a courtesy, not the gate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { leaveCommunityAction } from "@/app/communities/actions";

function LeaveConfirm({
  communityName,
  onCancel,
  onConfirm,
  busy,
  error,
}: {
  communityName: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
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
        aria-label={`Leave ${communityName}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">warning</span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Leave {communityName}?
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              You&apos;ll need to request to join again to come back.
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
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {busy ? "Leaving…" : "Leave"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a last admin sees instead of the confirm dialog above — same
 *  dialog shell, but there's nothing to confirm: leaving isn't offered,
 *  only explained. Shown ONLY after a click (see this file's own header
 *  comment) — never before. */
function LastAdminNotice({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="You're the only admin"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-secondary shrink-0">info</span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              You&apos;re the only admin
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              Promote another member to admin before you can leave — a community always needs at
              least one.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end mt-6">
          <button
            type="button"
            onClick={onClose}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeaveButton({
  communityId,
  communityName,
  slug,
  isLastAdmin,
  className,
}: {
  communityId: string;
  communityName: string;
  slug: string;
  /** True only when the viewer is the community's sole active admin — see
   *  this file's own header comment on what changes (only the dialog on
   *  click, nothing about the trigger itself). */
  isLastAdmin: boolean;
  /** Trigger button styling — callers place this differently (header vs.
   *  bottom of the Manage card), so the class list isn't hardcoded here. */
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const confirmLeave = async () => {
    setBusy(true);
    setError(null);
    const res = await leaveCommunityAction(communityId, slug);
    if (res.ok) {
      // Redirect away, not just refresh — the visitor is no longer a
      // member, so staying on this page would mean re-rendering it back
      // into the "Request to join" state under them.
      router.push("/communities");
      router.refresh();
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={className ?? "font-label-sm text-label-sm text-secondary/60 hover:text-error transition-colors"}
      >
        Leave
      </button>

      {confirming &&
        (isLastAdmin ? (
          <LastAdminNotice onClose={() => setConfirming(false)} />
        ) : (
          <LeaveConfirm
            communityName={communityName}
            busy={busy}
            error={error}
            onCancel={() => {
              setConfirming(false);
              setError(null);
            }}
            onConfirm={confirmLeave}
          />
        ))}
    </>
  );
}
