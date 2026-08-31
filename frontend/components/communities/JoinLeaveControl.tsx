"use client";

// Request/leave control for a community's own page — same states as
// CommunityPanel's JoinAction (components/collaborate/CommunityPanel.tsx),
// reimplemented here rather than reused because that one revalidates
// /collaborate's own querystring URL, not /communities/[slug]; the states
// and copy are deliberately identical.
//
// LEAVING, FOR AN ADMIN: `isLastAdmin` (computed server-side —
// app/communities/[slug]/page.tsx, from the same admin-only roster read
// the Manage panel already needs, so this costs nothing extra) is the
// UI-side check: an admin who IS the last one sees Leave disabled with a
// reason instead of a button, so they get a clear answer without a round
// trip. enforce_community_admin_guard (the trigger) is still the actual
// backstop — this is a courtesy, not the gate, same relationship every
// other admin-only control here has to its RLS/trigger enforcement.
//
// CONFIRMATION: only the "leave an active membership" path asks — the
// "withdraw a pending request" path (below) doesn't, unchanged, because
// withdrawing was never destructive to anything but your own unresolved
// request.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { joinCommunityAction, leaveCommunityAction } from "@/app/communities/actions";
import type { Membership } from "@/lib/server/communities";

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

export default function JoinLeaveControl({
  communityId,
  communityName,
  slug,
  isOpen,
  membership,
  isLastAdmin,
}: {
  communityId: string;
  communityName: string;
  slug: string;
  isOpen: boolean;
  membership: Membership;
  /** True only when membership.role === "admin" AND no other active admin
   *  exists — meaningless (and unused) for any other role. See this
   *  file's own header comment. */
  isLastAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (membership.state === "signed_out") {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(`/communities/${slug}`)}`}
        className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm"
      >
        Sign in to request to join
      </Link>
    );
  }

  if (membership.state === "active") {
    const isAdmin = membership.role === "admin";

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
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
            <span className="material-symbols-outlined text-base">check_circle</span>
            {isAdmin ? "Admin" : membership.role === "lead" ? "Lead" : "Member"}
          </span>
          {isAdmin && isLastAdmin ? (
            <span
              className="font-label-sm text-label-sm text-secondary/60 cursor-default"
              title="Promote another member to admin before you can leave."
            >
              Leave
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="font-label-sm text-label-sm text-secondary/60 hover:text-error transition-colors"
            >
              Leave
            </button>
          )}
        </div>
        {isAdmin && isLastAdmin && (
          <span className="font-body-sm text-body-sm text-secondary max-w-[220px] text-right">
            You&apos;re the only admin — promote another member first.
          </span>
        )}

        {confirming && (
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
        )}
      </div>
    );
  }

  if (membership.state === "pending") {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm">
          <span className="material-symbols-outlined text-base">hourglass_empty</span>
          Request pending
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await leaveCommunityAction(communityId, slug);
            if (res.ok) {
              router.refresh();
            } else {
              setError(res.error);
              setBusy(false);
            }
          }}
          className="font-label-sm text-label-sm text-secondary/60 hover:text-error transition-colors"
        >
          Withdraw
        </button>
        {error && <span className="font-body-sm text-body-sm text-error">{error}</span>}
      </div>
    );
  }

  // membership.state === "none"
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await joinCommunityAction(communityId, isOpen, slug);
          if (res.ok) {
            router.refresh();
          } else {
            setError(res.error);
            setBusy(false);
          }
        }}
        className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
      >
        {busy ? "…" : "Request to join"}
      </button>
      {error && <span className="font-body-sm text-body-sm text-error">{error}</span>}
    </div>
  );
}
