"use client";

// /teams/new: one field, one optional box, one button. Signed out, the button
// becomes the existing sign-in link with a way back here that keeps the typed
// name (lib/server/teams/teamRules.ts: createTeamCallback). No new auth.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTeamAction } from "@/app/teams/actions";
import { createTeamCallback, TEAM_NAME_MAX } from "@/lib/server/teams/teamRules";

const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function CreateTeamForm({ signedIn, initialName }: { signedIn: boolean; initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !signedIn) return;
    setSaving(true);
    setError(null);
    const res = await createTeamAction({ name, emails });
    if (!res.ok) {
      setError(res.error);
      setSaving(false);
      return;
    }
    const skipped = res.problems.length;
    router.push(`/teams/${res.slug}?created=1${skipped ? `&skipped=${skipped}` : ""}`);
  };

  return (
    <form onSubmit={submit} className="glass-panel rounded-2xl p-6 md:p-8 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="team-name" className="font-label-md text-label-md text-on-background">
          Team name
        </label>
        <input
          id="team-name"
          type="text"
          required
          autoFocus
          maxLength={TEAM_NAME_MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. KRAS journal club"
          className={INPUT}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="team-emails" className="font-label-md text-label-md text-on-background">
          Invite by email <span className="text-secondary font-normal">(optional)</span>
        </label>
        <textarea
          id="team-emails"
          rows={3}
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          placeholder="name@uab.edu, other@uab.edu"
          className={`${INPUT} resize-y`}
        />
        <p className="font-body-sm text-body-sm text-secondary">
          Separate emails with commas or new lines. You can also bring people in later with the QR code.
        </p>
      </div>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      {signedIn ? (
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="btn-primary self-start px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create team"}
        </button>
      ) : (
        <div className="flex flex-col gap-2 items-start">
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(createTeamCallback(name))}`}
            className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Sign in or create an account to create your team
          </Link>
          <p className="font-body-sm text-body-sm text-secondary">We keep the name you typed.</p>
        </div>
      )}
    </form>
  );
}
