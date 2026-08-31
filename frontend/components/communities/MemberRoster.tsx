"use client";

// Admin's member roster — promote/demote (role select) and remove. Every
// guard that actually matters (an admin can't touch a different admin, a
// community always keeps at least one admin) is the
// enforce_community_admin_guard trigger, not this component — a blocked
// action here just surfaces whatever message the trigger raised
// (changeCommunityMemberRoleAction/removeCommunityMemberAction pass it
// through as-is). This component's own restriction (hiding the controls on
// a DIFFERENT admin's row, and never showing "remove" on your own) is a
// courtesy so an admin doesn't have to discover the trigger's rule by
// hitting the error.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  changeCommunityMemberRoleAction,
  removeCommunityMemberAction,
} from "@/app/communities/actions";
import type { CommunityMember, CommunityRole } from "@/lib/server/communities";

const ROLE_LABEL: Record<CommunityRole, string> = {
  admin: "Admin",
  lead: "Lead",
  member: "Member",
};

export default function MemberRoster({
  communityId,
  slug,
  members,
  viewerUserId,
}: {
  communityId: string;
  slug: string;
  members: CommunityMember[];
  /** The signed-in admin's own user id — hides role/remove controls on any
   *  OTHER admin's row (self stays editable, so stepping down still works)
   *  before the trigger ever has to reject it. */
  viewerUserId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <ul className="divide-y divide-outline-variant/20">
        {members.map((m) => {
          const isOtherAdmin = m.role === "admin" && m.user_id !== viewerUserId;
          const busy = busyId === m.id;
          return (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="font-body-sm text-body-sm text-on-background truncate">
                {m.email || "Unlinked"}
                {!m.user_id && (
                  <span className="ml-2 font-body-sm text-body-sm text-secondary">
                    (invited — not signed up yet)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {isOtherAdmin ? (
                  <span className="font-label-sm text-label-sm text-secondary px-2">Admin</span>
                ) : (
                  <>
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={async (e) => {
                        const role = e.target.value as CommunityRole;
                        setBusyId(m.id);
                        setError(null);
                        const res = await changeCommunityMemberRoleAction(communityId, m.id, role, slug);
                        if (res.ok) router.refresh();
                        else setError(res.error);
                        setBusyId(null);
                      }}
                      className="bg-surface-container-lowest border border-outline-variant/40 rounded-md px-2 py-1 font-label-sm text-label-sm text-on-background"
                    >
                      {(Object.keys(ROLE_LABEL) as CommunityRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    {m.role !== "admin" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusyId(m.id);
                          setError(null);
                          const res = await removeCommunityMemberAction(communityId, m.id, slug);
                          if (res.ok) router.refresh();
                          else setError(res.error);
                          setBusyId(null);
                        }}
                        className="font-label-sm text-label-sm text-secondary hover:text-error transition-colors px-2"
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  );
}
