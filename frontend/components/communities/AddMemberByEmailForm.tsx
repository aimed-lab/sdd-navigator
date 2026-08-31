"use client";

// Admin's "add by email" — the second way in. One field, member
// immediately (no approval step, no waiting) — see
// addCommunityMemberByEmail's own comment on the link-now-or-at-signup
// behavior.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCommunityMemberByEmailAction } from "@/app/communities/actions";

export default function AddMemberByEmailForm({
  communityId,
  slug,
}: {
  communityId: string;
  slug: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !email.trim()) return;

    setSaving(true);
    setError(null);
    setAdded(null);

    const res = await addCommunityMemberByEmailAction(communityId, slug, email.trim());
    if (res.ok) {
      setAdded(email.trim());
      setEmail("");
      router.refresh();
    } else {
      setError(res.error);
    }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="add-member-email" className="font-label-md text-label-md text-on-background">
        Add a member by email
      </label>
      <div className="flex items-center gap-2">
        <input
          id="add-member-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-sm text-body-sm text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={saving || !email.trim()}
          className="btn-primary px-5 py-2.5 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
      <p className="font-body-sm text-body-sm text-secondary">
        They're a member right away — linked now if they already have an account, or the moment
        they sign in if not.
      </p>
      {added && (
        <p className="font-body-sm text-body-sm text-primary">Added {added}.</p>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
