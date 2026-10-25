"use client";

// Team settings (leads only): rename, join link + QR, invite by email, make
// someone a Lead, remove a member, link the team to a community, delete the
// team. Everything calls the community actions a team reuses, or
// app/teams/actions.ts. The database is the real gate for each.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  changeCommunityMemberRoleAction,
  deleteCommunityAction,
  removeCommunityMemberAction,
} from "@/app/communities/actions";
import { linkTeamAction, unlinkTeamAction, updateTeamDetailsAction } from "@/app/teams/actions";
import AddMemberByEmailForm from "@/components/communities/AddMemberByEmailForm";
import CopyLinkButton from "@/components/communities/CopyLinkButton";
import { roleLabel } from "@/lib/server/teams/teamRules";
import type { CommunityMember } from "@/lib/server/communities";
import type { LinkedCommunity } from "@/lib/server/teams/teams";

const INPUT =
  "bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

function Block({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="flex flex-col gap-3 border-t border-outline-variant/20 pt-6 first:border-t-0 first:pt-0">
      <h3 className="font-label-lg text-label-lg text-on-background">{title}</h3>
      {children}
    </div>
  );
}

export default function TeamSettings({
  team,
  members,
  viewerUserId,
  linked,
  linkable,
  defaultOpen,
}: {
  team: { id: string; slug: string; name: string };
  members: CommunityMember[];
  viewerUserId: string;
  linked: LinkedCommunity[];
  linkable: LinkedCommunity[];
  defaultOpen: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pick, setPick] = useState("");

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setBusy(key);
    setError(null);
    setSaved(false);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    after?.();
    router.refresh();
  };

  const leadCount = members.filter((m) => m.role === "admin").length;
  const unlinked = linkable.filter((c) => !linked.some((l) => l.id === c.id));

  return (
    <details id="settings" open={defaultOpen} className="rounded-2xl glass-panel p-5 md:p-6 group">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
        <span className="font-headline-sm text-headline-sm text-on-background">Team settings</span>
        <span className="material-symbols-outlined text-secondary group-open:rotate-180 transition-transform">expand_more</span>
      </summary>

      <div className="mt-6 flex flex-col gap-6">
        <Block title="Team name">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("rename", () => updateTeamDetailsAction(team.id, team.slug, { name }), () => setSaved(true));
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Team name" className={`${INPUT} flex-1 min-w-[12rem]`} />
            <button type="submit" disabled={busy === "rename" || !name.trim() || name.trim() === team.name} className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50">
              {busy === "rename" ? "Saving…" : "Rename"}
            </button>
            {saved && <span className="font-body-sm text-body-sm text-primary">Saved.</span>}
          </form>
          <p className="font-body-sm text-body-sm text-secondary">Change the one-line description from the top of the page.</p>
        </Block>

        <Block title="Join link">
          <p className="font-body-sm text-body-sm text-secondary">
            Anyone with the link or the QR code (top of the page) can join. They see only the team name until they do.
          </p>
          <CopyLinkButton slug={team.slug} label="Copy join link" team />
        </Block>

        <Block title="Invite by email" id="team-invite">
          <AddMemberByEmailForm communityId={team.id} slug={team.slug} />
        </Block>

        <Block title={`People (${members.length})`}>
          <ul className="flex flex-col divide-y divide-outline-variant/20">
            {members.map((m) => {
              const me = m.user_id === viewerUserId;
              const isLead = m.role === "admin";
              const label = m.display_name || m.email || "Unnamed";
              return (
                <li key={m.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-label-md text-label-md text-on-background break-words">
                      {label}
                      {me ? " (you)" : ""}
                    </p>
                    <p className="font-body-sm text-body-sm text-secondary">
                      {roleLabel(m.role)}
                      {!m.user_id ? " · invited, not signed in yet" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {!isLead && (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => run(m.id, () => changeCommunityMemberRoleAction(team.id, m.id, "admin", team.slug))}
                        className="font-label-sm text-label-sm text-primary hover:underline disabled:opacity-50"
                      >
                        Make Lead
                      </button>
                    )}
                    {isLead && me && leadCount > 1 && (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => run(m.id, () => changeCommunityMemberRoleAction(team.id, m.id, "member", team.slug))}
                        className="font-label-sm text-label-sm text-secondary hover:text-primary disabled:opacity-50"
                      >
                        Step down as Lead
                      </button>
                    )}
                    {!isLead && (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => {
                          if (window.confirm(`Remove ${label} from the team?`)) {
                            void run(m.id, () => removeCommunityMemberAction(team.id, m.id, team.slug));
                          }
                        }}
                        className="font-label-sm text-label-sm text-secondary hover:text-error disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="font-body-sm text-body-sm text-secondary">
            A team always keeps at least one Lead, and one Lead can&apos;t remove another. A Lead can step down on their own.
          </p>
        </Block>

        <Block title="Link to a community">
          {linked.length > 0 && (
            <ul className="flex flex-col gap-2">
              {linked.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <span className="font-body-md text-body-md text-on-background">{c.name}</span>
                  <button
                    type="button"
                    disabled={busy === c.id}
                    onClick={() => run(c.id, () => unlinkTeamAction(team.id, team.slug, c.id))}
                    className="font-label-sm text-label-sm text-secondary hover:text-error disabled:opacity-50"
                  >
                    Unlink
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unlinked.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Community" className={`${INPUT} flex-1 min-w-[12rem]`}>
                <option value="">Choose a community</option>
                {unlinked.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!pick || busy === "link"}
                onClick={() => run("link", () => linkTeamAction(team.id, team.slug, pick), () => setPick(""))}
                className="btn-outline px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
              >
                {busy === "link" ? "Linking…" : "Link"}
              </button>
            </div>
          ) : (
            <p className="font-body-sm text-body-sm text-secondary">
              {linked.length > 0
                ? "Linked to every community you are in."
                : "Not linked to a community. You can link to a community you have joined. Only its name and size are shown there; your content stays private."}
            </p>
          )}
        </Block>

        <Block title="Delete team">
          <p className="font-body-sm text-body-sm text-secondary">
            Removes the team, its shared documents and its news for everyone. Wiki pages are not deleted.
          </p>
          <button
            type="button"
            disabled={busy === "delete"}
            onClick={() => {
              if (window.confirm(`Delete "${team.name}"? This can't be undone.`)) {
                void run(
                  "delete",
                  () => deleteCommunityAction(team.id),
                  () => router.push("/teams?deleted=1")
                );
              }
            }}
            className="self-start px-5 py-2.5 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {busy === "delete" ? "Deleting…" : "Delete team"}
          </button>
        </Block>

        {error && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
