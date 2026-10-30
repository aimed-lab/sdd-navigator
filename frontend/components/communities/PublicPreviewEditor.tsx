"use client";

// Admin control over what a NON-member sees before joining — inside
// "Manage community", next to SectionsEditor, same structural idiom (local
// state initialized from the page's current value, nothing persisted
// until Save). This is the equivalent choice to SectionsEditor's own: that
// one decides what appears for a MEMBER; this decides WHO can see the
// community's size and activity before they've joined at all — a private
// working group may want to show nothing beyond its name, an open
// community may want a real preview of its feed.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCommunityPublicPreviewAction, updateShowPinnedToPublicAction } from "@/app/communities/actions";
import { PUBLIC_PREVIEW_LABEL, PUBLIC_PREVIEW_LEVELS, type PublicPreviewLevel } from "@/lib/communityTypes";

export default function PublicPreviewEditor({
  communityId,
  slug,
  level,
  showPinned = false,
}: {
  communityId: string;
  slug: string;
  level: PublicPreviewLevel;
  /** "Also show the pinned link to non-members" (communities.show_pinned_to_public). */
  showPinned?: boolean;
}) {
  const router = useRouter();
  const [local, setLocal] = useState<PublicPreviewLevel>(level);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [pinnedLocal, setPinnedLocal] = useState(showPinned);
  const dirty = local !== level || pinnedLocal !== showPinned;

  const save = async () => {
    setSaving(true);
    setError(null);
    let res: { ok: true } | { ok: false; error: string } = { ok: true };
    if (local !== level) res = await updateCommunityPublicPreviewAction(communityId, local, slug);
    if (res.ok && pinnedLocal !== showPinned) res = await updateShowPinnedToPublicAction(communityId, pinnedLocal, slug);
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-outline-variant/20 pt-8">
      <h3 className="font-label-lg text-label-lg text-on-background">What non-members see</h3>
      <p className="font-body-sm text-body-sm text-secondary">
        A signed-out visitor, or anyone who hasn&apos;t joined yet, sees this before deciding
        whether to join.
      </p>

      <ul className="rounded-lg border border-outline-variant/30 divide-y divide-outline-variant/20">
        {PUBLIC_PREVIEW_LEVELS.map((option) => (
          <li key={option} className="flex items-center px-4 py-2.5">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="public-preview-level"
                checked={local === option}
                onChange={() => {
                  setLocal(option);
                  setSaved(false);
                }}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span className="font-body-sm text-body-sm text-on-background">
                {PUBLIC_PREVIEW_LABEL[option]}
              </span>
            </label>
            {option === "open" && (
              <p className="mt-1 ml-[26px] font-body-sm text-body-sm text-secondary">
                The feed is visible but not clickable or bookmarkable — a visitor can see
                what&apos;s there, not act on it. This makes every member&apos;s name,
                institution, and what they work on here readable by anyone with the link,
                not just other members. No email is ever shown to a non-member — Connect
                still requires joining.
              </p>
            )}
          </li>
        ))}
      </ul>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={pinnedLocal}
          onChange={(e) => {
            setPinnedLocal(e.target.checked);
            setSaved(false);
          }}
          className="mt-0.5 w-4 h-4 accent-primary cursor-pointer"
        />
        <span className="font-body-sm text-body-sm text-on-background">
          Also show the pinned link to non-members
          <span className="block text-secondary">
            Works when the pinned resource is a link (not a file). Visitors see its title, description and an Open button,
            nothing else.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="btn-outline px-5 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !error && !dirty && (
          <span className="font-body-sm text-body-sm text-primary">Saved.</span>
        )}
        {error && (
          <span className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
