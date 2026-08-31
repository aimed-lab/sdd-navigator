"use client";

// Admin's approve/reject queue — same shape as CommunityPanel's
// PendingRequests (components/collaborate/CommunityPanel.tsx), extended
// with Reject (that one only ever had Approve).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveMembershipAction, rejectMembershipAction } from "@/app/communities/actions";
import type { PendingRequest } from "@/lib/server/communities";

export default function PendingRequestsPanel({
  requests,
  slug,
}: {
  requests: PendingRequest[];
  slug: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) {
    return <p className="font-body-sm text-body-sm text-secondary">No pending requests.</p>;
  }

  return (
    <div>
      <ul className="space-y-2">
        {requests.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 bg-surface-container-low rounded-lg px-4 py-2.5"
          >
            <span className="font-body-sm text-body-sm text-on-background truncate">
              {r.email || "Unknown"}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={async () => {
                  setBusyId(r.id);
                  setError(null);
                  const res = await approveMembershipAction(r.id, slug);
                  if (res.ok) router.refresh();
                  else setError(res.error);
                  setBusyId(null);
                }}
                className="btn-outline px-3 py-1.5 rounded-md font-label-sm text-label-sm"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={async () => {
                  setBusyId(r.id);
                  setError(null);
                  const res = await rejectMembershipAction(r.id, slug);
                  if (res.ok) router.refresh();
                  else setError(res.error);
                  setBusyId(null);
                }}
                className="font-label-sm text-label-sm text-secondary hover:text-error transition-colors px-2"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  );
}
