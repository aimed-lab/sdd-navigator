"use client";

// Lets the viewer hide or unhide THEMSELVES from the member-facing roster
// — rendered only on the viewer's own card (MembersSection.tsx), same
// self-only shape as FocusField, and self-only server-side too: "Community
// members: self update own row" (RLS) + the trigger that limits a
// self-update to `focus`/`hidden` only
// (2026-09-14_community_member_roster_pending_hidden.sql).
//
// A hidden row is filtered out of community_member_roster() for every
// OTHER caller, but the RPC has a deliberate self-exception: the viewer's
// own hidden row still comes back (with `hidden: true`), which is what
// makes this toggle reachable again after hiding — without that exception
// there would be no surface left to click "show me" on.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMyCommunityHiddenAction } from "@/app/communities/actions";

export default function HiddenToggle({
  communityId,
  slug,
  hidden,
}: {
  communityId: string;
  slug: string;
  hidden: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          const res = await updateMyCommunityHiddenAction(communityId, !hidden, slug);
          setSaving(false);
          if (res.ok) router.refresh();
          else setError(res.error);
        }}
        className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors"
      >
        {hidden ? "Show me in this roster" : "Hide me from this roster"}
      </button>
      {error && <p className="mt-1 font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  );
}
