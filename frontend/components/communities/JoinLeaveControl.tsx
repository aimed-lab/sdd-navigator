"use client";

// Request/leave control for a community's own page — same states as
// CommunityPanel's JoinAction (components/collaborate/CommunityPanel.tsx),
// reimplemented here rather than reused because that one revalidates
// /collaborate's own querystring URL, not /communities/[slug]; the states
// and copy are deliberately identical.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { joinCommunityAction, leaveCommunityAction } from "@/app/communities/actions";
import type { Membership } from "@/lib/server/communities";

export default function JoinLeaveControl({
  communityId,
  slug,
  isOpen,
  membership,
}: {
  communityId: string;
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
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
          <span className="material-symbols-outlined text-base">check_circle</span>
          {membership.role === "admin" ? "Admin" : membership.role === "lead" ? "Lead" : "Member"}
        </span>
        {membership.role !== "admin" && (
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
            Leave
          </button>
        )}
        {error && <span className="font-body-sm text-body-sm text-error">{error}</span>}
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
