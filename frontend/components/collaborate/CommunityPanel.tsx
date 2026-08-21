"use client";

// The panel shown when a community is selected on /collaborate: join/request/
// member state, a copy-link Share action, and — for a lead only — the list of
// pending requests to approve. All the DATA here (membership state, isLead,
// pending requests, stats) is computed server-side and passed in as props;
// this component only handles the interactive bits (the join/leave/approve
// calls and the clipboard copy).
//
// SIGNED OUT: shows a "Sign in to join" prompt, not a wall — browsing (posts,
// resources, activity) all render regardless of session, from the server
// component around this one.

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  approveMembershipAction,
  joinCommunityAction,
  leaveCommunityAction,
} from "@/app/collaborate/actions";
import type { Membership, PendingRequest } from "@/lib/server/communities";

function JoinAction({
  communityId,
  isOpen,
  membership,
}: {
  communityId: string;
  isOpen: boolean;
  membership: Membership;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (membership.state === "signed_out") {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
        className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md"
      >
        Sign in to join
      </Link>
    );
  }

  if (membership.state === "active") {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
          <span className="material-symbols-outlined text-base">check_circle</span>
          Member
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await leaveCommunityAction(communityId);
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
            const res = await leaveCommunityAction(communityId);
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
          const res = await joinCommunityAction(communityId, isOpen);
          if (res.ok) {
            router.refresh();
          } else {
            setError(res.error);
            setBusy(false);
          }
        }}
        className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
      >
        {busy ? "…" : isOpen ? "Join" : "Request to join"}
      </button>
      {error && <span className="font-body-sm text-body-sm text-error">{error}</span>}
    </div>
  );
}

function ShareButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        // Built at click time from the browser's own origin — the server
        // component only knows the path (?community=<slug>), never the host
        // it's being served from in this environment.
        const url = typeof window !== "undefined" ? window.location.origin + path : path;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard API can be unavailable (older browser, non-secure
          // context) — the link is still selectable text in the URL bar, so
          // failing quietly here doesn't strand anyone.
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="btn-outline inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-label-md text-label-md"
    >
      <span className="material-symbols-outlined text-base">
        {copied ? "check" : "link"}
      </span>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

function PendingRequests({ requests }: { requests: PendingRequest[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl bg-surface-container-low p-4">
      <p className="font-label-md text-label-md text-on-background mb-2">
        Pending requests ({requests.length})
      </p>
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <span className="font-body-sm text-body-sm text-secondary truncate">
              {r.email || "Unknown"}
            </span>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={async () => {
                setBusyId(r.id);
                setError(null);
                const res = await approveMembershipAction(r.id);
                if (res.ok) {
                  router.refresh();
                } else {
                  setError(res.error);
                }
                setBusyId(null);
              }}
              className="btn-outline px-3 py-1.5 rounded-md font-label-sm text-label-sm shrink-0"
            >
              Approve
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  );
}

export default function CommunityPanel({
  communityId,
  isOpen,
  sharePath,
  membership,
  pendingRequests,
}: {
  communityId: string;
  isOpen: boolean;
  sharePath: string;
  membership: Membership;
  pendingRequests: PendingRequest[];
}) {
  return (
    <div className="mt-4 glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <JoinAction communityId={communityId} isOpen={isOpen} membership={membership} />
        <ShareButton path={sharePath} />
      </div>
      {membership.isLead && <PendingRequests requests={pendingRequests} />}
    </div>
  );
}
