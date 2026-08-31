"use client";

// The join/request-state + Share controls shown when a community is
// selected on /collaborate. All the DATA here (membership state, isLead,
// pending requests, stats) is computed server-side and passed in as props;
// this component only handles the interactive bits (the join/leave/approve
// calls and the clipboard copy).
//
// SIGNED OUT: shows a "Sign in to join" prompt, not a wall — browsing (posts,
// resources, activity) all render regardless of session, from the server
// component around this one.
//
// VISUAL WEIGHT (2026-08-21 design pass): this used to be its own glass-panel
// box sitting alone between the filters and the results — a container whose
// only content, most of the time, was one small button. It's now an inline
// row folded into the page header (see app/collaborate/page.tsx), and every
// button here is intentionally SECONDARY (btn-outline / quiet text, never
// btn-primary): "Add to the board" is the one primary action on this screen,
// and Join competing with it in the same green read as two things of equal
// importance when they aren't. The lead-only pending-requests list keeps its
// own small tinted block below the row, but only ever renders when there's
// at least one request in it — never as an empty container.

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  approveMembershipAction,
  joinCommunityAction,
  leaveCommunityAction,
} from "@/app/collaborate/actions";
import type { Membership, PendingRequest } from "@/lib/server/communities";

/** The exact URL on screen (path + querystring) — this is the Router Cache
 *  key that has to be revalidated for the button to update without a full
 *  navigation. See app/collaborate/actions.ts's revalidateCollaborate(). */
function useCurrentPath(): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

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
  const currentPath = useCurrentPath();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (membership.state === "signed_out") {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
        className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm"
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
            const res = await leaveCommunityAction(communityId, currentPath);
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
            const res = await leaveCommunityAction(communityId, currentPath);
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
          const res = await joinCommunityAction(communityId, isOpen, currentPath);
          if (res.ok) {
            router.refresh();
          } else {
            setError(res.error);
            setBusy(false);
          }
        }}
        className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
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
      className="btn-outline inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-label-sm text-label-sm"
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
  const currentPath = useCurrentPath();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl bg-surface-container-low p-4">
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
                const res = await approveMembershipAction(r.id, currentPath);
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
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <JoinAction communityId={communityId} isOpen={isOpen} membership={membership} />
        <ShareButton path={sharePath} />
      </div>
      {membership.isAdmin && <PendingRequests requests={pendingRequests} />}
    </div>
  );
}
