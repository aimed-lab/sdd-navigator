"use client";

// Request/leave/badge control for a community's own page — same states as
// CommunityPanel's JoinAction (components/collaborate/CommunityPanel.tsx),
// reimplemented here rather than reused because that one revalidates
// /collaborate's own querystring URL, not /communities/[slug]; the states
// and copy are deliberately identical.
//
// LEAVE, FOR AN ADMIN, IS NOT RENDERED HERE. An admin's Leave lives at the
// bottom of the "Manage community" card instead, next to Delete community
// (app/communities/[slug]/page.tsx) — that header corner was stacking too
// many controls (badge, Leave, the last-admin reason, Copy link, Delete).
// The ADMIN BADGE still renders here regardless — only the button moved.
// A non-admin active member (member or lead) never sees the Manage card at
// all (admin-only), so their Leave has nowhere else to be and stays right
// here, unchanged. See LeaveButton.tsx, the shared component both places
// use.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinCommunityAction, leaveCommunityAction } from "@/app/communities/actions";
import type { Membership } from "@/lib/server/communities";
import LeaveButton from "./LeaveButton";

export default function JoinLeaveControl({
  communityId,
  communityName,
  slug,
  isOpen,
  membership,
}: {
  communityId: string;
  communityName: string;
  slug: string;
  isOpen: boolean;
  membership: Membership;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
          <span className="material-symbols-outlined text-base">check_circle</span>
          {isAdmin ? "Admin" : membership.role === "lead" ? "Lead" : "Member"}
        </span>
        {!isAdmin && (
          <LeaveButton
            communityId={communityId}
            communityName={communityName}
            slug={slug}
            isLastAdmin={false}
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
