"use client";

// The three shelves under the tiles on a team page — Shared documents, Team
// wiki pages, People — plus the small team news list. Every empty state says
// what to do next.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAnnouncementAction,
  deleteCommunityResourceAction,
  pinCommunityResourceAction,
} from "@/app/communities/actions";
import { removeTeamPageAction } from "@/app/teams/actions";
import ConnectButton from "@/components/communities/ConnectButton";
import { downloadHref, initials, shortDate } from "@/lib/server/communityHome/communityHome";
import { pageLabel, roleLabel } from "@/lib/server/teams/teamRules";
import type { Announcement, CommunityResource, MemberRosterEntry } from "@/lib/server/communities";
import type { TeamPage } from "@/lib/server/teams/teams";

function Shelf({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-headline-sm text-headline-sm text-on-background">
        {title} <span className="font-body-md text-body-md text-secondary">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-surface-container-low px-5 py-4 font-body-md text-body-md text-secondary">{children}</p>;
}

function useDo() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Something went wrong.");
  };
  return { busy, error, run };
}

const small = "font-label-sm text-label-sm text-secondary hover:text-error disabled:opacity-50";

// ── documents ───────────────────────────────────────────────────────────────

export function DocumentsShelf({
  teamId,
  slug,
  resources,
  pinnedId,
  viewerId,
  isLead,
  names,
}: {
  teamId: string;
  slug: string;
  resources: CommunityResource[];
  pinnedId: string | null;
  viewerId: string;
  isLead: boolean;
  names: Record<string, string>;
}) {
  const { busy, error, run } = useDo();
  const ordered = [...resources].sort((a, b) => Number(b.id === pinnedId) - Number(a.id === pinnedId));

  return (
    <Shelf title="Shared documents" count={resources.length}>
      {ordered.length === 0 ? (
        <Empty>Nothing shared yet. Click Share a document above to upload a file or add a link.</Empty>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ordered.map((r) => {
            const canRemove = isLead || r.added_by === viewerId;
            return (
              <li key={r.id} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-label-lg text-label-lg text-on-background break-words">
                    {r.id === pinnedId && (
                      <span className="material-symbols-outlined text-primary text-base align-text-bottom mr-1" title="Pinned">
                        push_pin
                      </span>
                    )}
                    {r.title}
                  </p>
                  <div className="flex items-center gap-3 shrink-0">
                    {isLead && (
                      <button
                        type="button"
                        className={small}
                        disabled={busy === r.id}
                        onClick={() => run(r.id, () => pinCommunityResourceAction(teamId, r.id === pinnedId ? null : r.id, slug))}
                      >
                        {r.id === pinnedId ? "Unpin" : "Pin"}
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        className={small}
                        disabled={busy === r.id}
                        onClick={() => {
                          if (window.confirm(`Remove "${r.title}" from the team?`)) {
                            void run(r.id, () => deleteCommunityResourceAction(teamId, r.id, slug));
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-label-md text-label-md text-primary hover:underline inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-base">open_in_new</span>
                      Open link
                    </a>
                  )}
                  {r.files.map((f) => (
                    <a key={f.id} href={downloadHref(f.url, f.filename)} className="font-label-md text-label-md text-primary hover:underline inline-flex items-center gap-1 break-all">
                      <span className="material-symbols-outlined text-base">download</span>
                      {f.filename}
                    </a>
                  ))}
                </div>
                <p className="font-body-sm text-body-sm text-secondary">
                  {names[r.added_by] ? `${names[r.added_by]} · ` : ""}
                  {shortDate(r.created_at)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="font-body-sm text-body-sm text-error" role="alert">{error}</p>}
    </Shelf>
  );
}

// ── wiki pages ──────────────────────────────────────────────────────────────

export function PagesShelf({ teamId, slug, pages, names }: { teamId: string; slug: string; pages: TeamPage[]; names: Record<string, string> }) {
  const { busy, error, run } = useDo();

  return (
    <Shelf title="Team wiki pages" count={pages.length}>
      {pages.length === 0 ? (
        <Empty>No wiki pages yet. Click Curate wiki pages to add one, or Make learning material to have the assistant write one.</Empty>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pages.map((p) => (
            <li key={p.pageId} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/pages/${p.slug}`} className="font-label-lg text-label-lg text-primary hover:underline break-words">
                  {p.title}
                </Link>
                {p.canRemove && (
                  <button
                    type="button"
                    className={`shrink-0 ${small}`}
                    disabled={busy === p.pageId}
                    onClick={() => {
                      if (window.confirm(`Take "${p.title}" off the team? The page itself is not deleted.`)) {
                        void run(p.pageId, () => removeTeamPageAction(teamId, slug, p.pageId));
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="font-body-sm text-body-sm text-secondary">
                <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 font-label-sm text-label-sm">
                  {pageLabel(p.how)}
                </span>{" "}
                {p.addedBy && names[p.addedBy] ? `${names[p.addedBy]} · ` : ""}
                {shortDate(p.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="font-body-sm text-body-sm text-error" role="alert">{error}</p>}
    </Shelf>
  );
}

// ── people ──────────────────────────────────────────────────────────────────

export function PeopleShelf({
  teamId,
  roster,
  viewerUserId,
}: {
  teamId: string;
  roster: MemberRosterEntry[];
  viewerUserId: string;
}) {
  return (
    <Shelf title="People" count={roster.length}>
      {roster.length <= 1 ? (
        <Empty>Just you so far. Share the QR code above, or add emails in Team settings.</Empty>
      ) : null}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {roster.map((m) => (
          <li key={m.member_id} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex items-start gap-3">
            <span className="w-9 h-9 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center font-label-sm text-label-sm font-semibold">
              {initials(m.display_name)}
            </span>
            <div className="min-w-0">
              <p className="font-label-lg text-label-lg text-on-background break-words">{m.display_name}</p>
              <p className="font-body-sm text-body-sm text-secondary">
                {roleLabel(m.role)}
                {!m.signed_up ? " · invited" : ""}
              </p>
              {m.user_id !== viewerUserId && <ConnectButton communityId={teamId} memberId={m.member_id} />}
            </div>
          </li>
        ))}
      </ul>
    </Shelf>
  );
}

// ── news ────────────────────────────────────────────────────────────────────

export function NewsList({ teamId, slug, items, isLead }: { teamId: string; slug: string; items: Announcement[]; isLead: boolean }) {
  const { busy, error, run } = useDo();
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-headline-sm text-headline-sm text-on-background">Team news</h2>
      <ul className="flex flex-col gap-3">
        {items.slice(0, 5).map((a) => (
          <li key={a.id} className="rounded-xl bg-primary/5 border border-primary/20 p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-label-lg text-label-lg text-on-background break-words">{a.title}</p>
              {a.body && <p className="font-body-md text-body-md text-secondary whitespace-pre-line break-words">{a.body}</p>}
              <p className="mt-1 font-body-sm text-body-sm text-secondary">{shortDate(a.created_at)}</p>
            </div>
            {isLead && (
              <button
                type="button"
                className={`shrink-0 ${small}`}
                disabled={busy === a.id}
                onClick={() => {
                  if (window.confirm("Delete this news item?")) void run(a.id, () => deleteAnnouncementAction(teamId, a.id, slug));
                }}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="font-body-sm text-body-sm text-error" role="alert">{error}</p>}
    </section>
  );
}
