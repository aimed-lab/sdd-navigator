"use client";

// The self-editable "what I work on here" line on the viewer's OWN member
// card (MembersSection.tsx renders this only for the row whose user_id
// matches the viewer — every other member's card renders the same value as
// plain text, no editor). Writes through updateMyCommunityFocusAction,
// which is self-only server-side (RLS "Community members: self update
// focus" + its trigger, 2026-09-13_community_member_focus.sql) — this
// component being the only caller for a given user's own row is a
// convenience, not the actual protection.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateMyCommunityFocusAction } from "@/app/communities/actions";

export default function FocusField({
  communityId,
  slug,
  focus,
}: {
  communityId: string;
  slug: string;
  focus: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(focus ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block w-full text-left font-body-sm text-body-sm text-secondary/70 line-clamp-2 hover:text-secondary transition-colors"
      >
        {focus || "Add what you work on →"}
      </button>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What do you work on here?"
        maxLength={160}
        disabled={saving}
        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-md px-2 py-1 font-body-sm text-body-sm text-on-background"
      />
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const res = await updateMyCommunityFocusAction(communityId, value, slug);
            setSaving(false);
            if (res.ok) {
              setEditing(false);
              router.refresh();
            } else {
              setError(res.error);
            }
          }}
          className="font-label-sm text-label-sm text-primary"
        >
          Save
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setValue(focus ?? "");
            setEditing(false);
            setError(null);
          }}
          className="font-label-sm text-label-sm text-secondary"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  );
}
