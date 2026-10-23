"use client";

// Team panel on a wiki page. The owner can add members by email (as editor
// or viewer) and remove them; editors and viewers see the list read-only.
// Members only get access while the page is set to Team, so the panel says so
// whenever it is not.
//
// Names come from public.users and are only visible for public profiles;
// anyone else shows as "Team member". Controls are a convenience: the server
// actions and the page_members RLS policies are the real gate.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMemberAction, removeMemberAction } from "@/app/pages/[slug]/actions";
import type { PageMemberView } from "@/lib/server/pages/pageView";
import type { PageVisibility } from "@/lib/server/pages/pageViewHelpers";

export default function TeamPanel({
  pageId,
  slug,
  visibility,
  members,
  isOwner,
}: {
  pageId: string;
  slug: string;
  visibility: PageVisibility;
  members: PageMemberView[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await addMemberAction(pageId, slug, email, role);
    setBusy(false);
    if (res.ok) {
      setEmail("");
      setNote(res.note ?? null);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  const remove = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await removeMemberAction(pageId, slug, userId);
    setBusy(false);
    setRemoving(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <section id="team" className="glass-panel rounded-2xl p-6 flex flex-col gap-4 scroll-mt-24" aria-label="Team">
      <h2 className="font-label-md text-label-md text-on-background">Team</h2>

      {visibility !== "team" && (
        <p className="font-body-sm text-body-sm text-secondary">
          Members only get access while this page is set to Team.
        </p>
      )}

      {members.length === 0 ? (
        <p className="font-body-sm text-body-sm text-secondary">No team members yet.</p>
      ) : (
        <ul className="divide-y divide-[#e7e4dc]">
          {members.map((m) => (
            <li key={m.user_id} className="py-2 flex items-center justify-between gap-3">
              <span className="font-body-md text-body-md text-on-background">
                {m.isViewer ? "You" : (m.name ?? "Team member")}
              </span>
              <span className="flex items-center gap-3">
                <span className="px-2.5 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm text-secondary capitalize">
                  {m.role}
                </span>
                {isOwner &&
                  (removing === m.user_id ? (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => remove(m.user_id)}
                        disabled={busy}
                        className="font-label-sm text-label-sm text-error disabled:opacity-50"
                      >
                        Confirm remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoving(null)}
                        disabled={busy}
                        className="font-label-sm text-label-sm text-secondary"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRemoving(m.user_id)}
                      disabled={busy}
                      className="font-label-sm text-label-sm text-secondary hover:text-error transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email of an existing account"
            aria-label="Email address"
            className="flex-1 min-w-0 px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-body-md"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value === "editor" ? "editor" : "viewer")}
            aria-label="Role"
            className="px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-body-md"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
          </select>
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}
      {isOwner && (
        <p className="-mt-2 font-body-sm text-body-sm text-secondary">
          Use the email they sign in to SmartDrugDiscovery with.
        </p>
      )}

      {note && (
        <p className="font-body-sm text-body-sm text-secondary" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
