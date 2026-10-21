"use client";

// Admin control, inside "Manage community": can anyone join, or do people
// request to join? Same shape as PublicPreviewEditor. Takes effect on Save;
// existing members and pending requests are not touched.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setCommunityOpenAction } from "@/app/communities/actions";

export default function IsOpenEditor({
  communityId,
  slug,
  isOpen,
}: {
  communityId: string;
  slug: string;
  isOpen: boolean;
}) {
  const router = useRouter();
  const [local, setLocal] = useState(isOpen);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = local !== isOpen;

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await setCommunityOpenAction(communityId, local, slug);
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  const options: { value: boolean; label: string; note: string }[] = [
    {
      value: true,
      label: "Anyone can join",
      note: "Signed-in people join with one click. Signed-out visitors (for example from the QR code) can join with just their email, no account; they are marked unverified until they sign in.",
    },
    {
      value: false,
      label: "Request to join",
      note: "People ask to join and an admin approves each request. Signed-out visitors are asked to sign in first.",
    },
  ];

  return (
    <div className="flex flex-col gap-3 border-t border-outline-variant/20 pt-8">
      <h3 className="font-label-lg text-label-lg text-on-background">Who can join</h3>
      <ul className="rounded-lg border border-outline-variant/30 divide-y divide-outline-variant/20">
        {options.map((o) => (
          <li key={String(o.value)} className="px-4 py-2.5">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="community-is-open"
                checked={local === o.value}
                onChange={() => {
                  setLocal(o.value);
                  setSaved(false);
                }}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span className="font-body-sm text-body-sm text-on-background">{o.label}</span>
            </label>
            <p className="mt-1 ml-[26px] font-body-sm text-body-sm text-secondary">{o.note}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="btn-primary px-5 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !dirty && <span className="font-body-sm text-body-sm text-primary">Saved.</span>}
        {error && (
          <span className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
