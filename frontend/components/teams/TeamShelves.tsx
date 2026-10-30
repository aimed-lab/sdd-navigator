"use client";

// The cards under the tiles on a team page: Team wiki pages and Shared
// documents (left, wide), People and Team news (right, narrow). Each card has
// a serif title, a count chip and, where it makes sense, a small "+ Add"
// button that opens the matching tile panel. Remove, Pin and the like sit in
// the existing ⋯ menu. Every empty state is a dashed box that says what to do.

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
import MoreMenu, { type MoreMenuItem } from "@/components/MoreMenu";
import { openAssistant } from "@/lib/server/assistant/assistantBridge";
import { downloadHref, initials, shortDate } from "@/lib/server/communityHome/communityHome";
import { makePagePrompt, pageLabel, roleLabel } from "@/lib/server/teams/teamRules";
import { byLine, FILE_KIND_STYLE, fileKind } from "@/lib/server/teams/teamUi";
import type { Announcement, CommunityResource, MemberRosterEntry } from "@/lib/server/communities";
import type { TeamPage } from "@/lib/server/teams/teams";
import { useTeamPanel } from "./TeamPanelContext";

const CARD = "rounded-2xl border border-[#e8e4da] bg-white p-5 flex flex-col gap-4 shadow-[0_1px_2px_rgba(40,36,28,0.05)] min-w-0";
const SMALL_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-[#d9d5c9] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold leading-5 text-on-background hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const ROW = "flex items-center gap-3 min-w-0 py-3 border-t border-[#efece3] first:border-t-0 first:pt-0 last:pb-0";

function Card({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-headline-sm text-[20px] leading-7 text-on-background flex items-center gap-2 min-w-0">
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="shrink-0 rounded-full bg-[#f1efe8] px-2 py-0.5 text-[12px] font-semibold leading-4 text-secondary">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ icon, text, children }: { icon: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#d9d5c9] px-4 py-6 flex flex-col items-center gap-3 text-center">
      <span className="material-symbols-outlined text-secondary/60 text-[28px]" aria-hidden>
        {icon}
      </span>
      <p className="font-body-md text-[14px] leading-[1.5] text-secondary">{text}</p>
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

function AddButton({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={`${SMALL_BTN} shrink-0`}>
      <span className="material-symbols-outlined text-[16px]">add</span>
      {label}
    </button>
  );
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

function Err({ text }: { text: string | null }) {
  return text ? (
    <p className="font-body-sm text-body-sm text-error" role="alert">
      {text}
    </p>
  ) : null;
}

// ── wiki pages ──────────────────────────────────────────────────────────────

export function PagesShelf({
  teamId,
  teamName,
  slug,
  pages,
  names,
}: {
  teamId: string;
  teamName: string;
  slug: string;
  pages: TeamPage[];
  names: Record<string, string>;
}) {
  const { busy, error, run } = useDo();
  const panel = useTeamPanel();

  return (
    <Card title="Team wiki pages" count={pages.length} action={<AddButton onClick={() => panel.open("pages")} />}>
      {pages.length === 0 ? (
        <Empty icon="menu_book" text="No wiki pages yet.">
          <button
            type="button"
            className={SMALL_BTN}
            onClick={() =>
              openAssistant({ text: makePagePrompt(teamName), mode: "fill", team: { id: teamId, name: teamName, slug } })
            }
          >
            <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
            Ask the AI
          </button>
          <button type="button" className={SMALL_BTN} onClick={() => panel.open("pages")}>
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add pages
          </button>
        </Empty>
      ) : (
        <ul>
          {pages.map((p) => {
            const label = pageLabel(p.how);
            const made = label === "Made by AI";
            const items: MoreMenuItem[] = p.canRemove
              ? [
                  {
                    label: "Remove",
                    danger: true,
                    onClick: () => {
                      if (window.confirm(`Take "${p.title}" off the team? The page itself is not deleted.`)) {
                        void run(p.pageId, () => removeTeamPageAction(teamId, slug, p.pageId));
                      }
                    },
                  },
                ]
              : [];
            return (
              <li key={p.pageId} className={`${ROW} ${busy === p.pageId ? "opacity-50" : ""}`}>
                <span className="w-9 h-9 shrink-0 rounded-lg bg-[#fef3c7] text-[#b45309] flex items-center justify-center" aria-hidden>
                  <span className="material-symbols-outlined text-[20px]">description</span>
                </span>
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                    <Link
                      href={`/pages/${p.slug}`}
                      className="font-label-lg text-[15px] leading-6 font-semibold text-on-background hover:text-primary hover:underline underline-offset-4 break-words min-w-0"
                    >
                      {p.title}
                    </Link>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-4 ${
                        made ? "bg-[#f3f1ea] text-[#1A5632]" : "bg-[#fef3c7] text-[#b45309]"
                      }`}
                    >
                      {made && <span className="material-symbols-outlined text-[13px]">auto_awesome</span>}
                      {label}
                    </span>
                  </div>
                  <p className="text-[12.5px] leading-5 text-secondary">
                    {byLine(p.addedBy ? names[p.addedBy] : null, shortDate(p.createdAt))}
                  </p>
                </div>
                <MoreMenu items={items} iconOnly className="shrink-0" />
              </li>
            );
          })}
        </ul>
      )}
      <Err text={error} />
    </Card>
  );
}

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
  const panel = useTeamPanel();
  const ordered = [...resources].sort((a, b) => Number(b.id === pinnedId) - Number(a.id === pinnedId));

  return (
    <Card title="Shared documents" count={resources.length} action={<AddButton onClick={() => panel.open("document")} />}>
      {ordered.length === 0 ? (
        <Empty icon="upload_file" text="Nothing shared yet.">
          <button type="button" className={SMALL_BTN} onClick={() => panel.open("document")}>
            <span className="material-symbols-outlined text-[16px]">add</span>
            Share a document
          </button>
        </Empty>
      ) : (
        <ul>
          {ordered.map((r) => {
            const canRemove = isLead || r.added_by === viewerId;
            const style = FILE_KIND_STYLE[fileKind(r)];
            const first = r.files[0];
            const openHref = first ? downloadHref(first.url, first.filename) : r.url;
            const pinned = r.id === pinnedId;
            const items: MoreMenuItem[] = [];
            if (isLead) {
              items.push({
                label: pinned ? "Unpin" : "Pin",
                onClick: () => void run(r.id, () => pinCommunityResourceAction(teamId, pinned ? null : r.id, slug)),
              });
            }
            if (canRemove) {
              items.push({
                label: "Remove",
                danger: true,
                onClick: () => {
                  if (window.confirm(`Remove "${r.title}" from the team?`)) {
                    void run(r.id, () => deleteCommunityResourceAction(teamId, r.id, slug));
                  }
                },
              });
            }
            return (
              <li key={r.id} className={`${ROW} ${busy === r.id ? "opacity-50" : ""}`}>
                <span
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center"
                  style={{ background: style.bg, color: style.fg }}
                  title={style.label}
                  aria-hidden
                >
                  <span className="material-symbols-outlined text-[20px]">{style.icon}</span>
                </span>
                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <p className="font-label-lg text-[15px] leading-6 font-semibold text-on-background break-words">
                    {pinned && (
                      <span className="material-symbols-outlined text-primary text-[16px] align-text-bottom mr-1" title="Pinned">
                        push_pin
                      </span>
                    )}
                    {r.title}
                  </p>
                  <p className="text-[12.5px] leading-5 text-secondary">{byLine(names[r.added_by], shortDate(r.created_at))}</p>
                  {r.files.length > 1 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {r.files.slice(1).map((f) => (
                        <a
                          key={f.id}
                          href={downloadHref(f.url, f.filename)}
                          className="text-[12.5px] leading-5 text-primary hover:underline break-all"
                        >
                          {f.filename}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                {openHref && (
                  <a
                    href={openHref}
                    {...(first ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                    className={`${SMALL_BTN} shrink-0`}
                  >
                    Open
                  </a>
                )}
                <MoreMenu items={items} iconOnly className="shrink-0" />
              </li>
            );
          })}
        </ul>
      )}
      <Err text={error} />
    </Card>
  );
}

// ── people ──────────────────────────────────────────────────────────────────

/** Opens Team settings and scrolls to its invite-by-email part. */
function openInvite() {
  const settings = document.getElementById("settings") as HTMLDetailsElement | null;
  if (settings) settings.open = true;
  document.getElementById("team-invite")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function PeopleShelf({
  teamId,
  roster,
  viewerUserId,
  isLead,
}: {
  teamId: string;
  roster: MemberRosterEntry[];
  viewerUserId: string;
  isLead: boolean;
}) {
  return (
    <Card
      title="People"
      count={roster.length}
      action={
        isLead ? (
          <button type="button" onClick={openInvite} className={`${SMALL_BTN} shrink-0`}>
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            Invite
          </button>
        ) : undefined
      }
    >
      <ul>
        {roster.map((m) => {
          const lead = roleLabel(m.role) === "Lead";
          return (
            <li key={m.member_id} className={ROW}>
              <span
                className="w-9 h-9 shrink-0 rounded-full bg-surface-container-low text-primary flex items-center justify-center text-[12px] font-semibold"
                aria-hidden
              >
                {initials(m.display_name)}
              </span>
              <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-label-lg text-[14.5px] leading-6 font-semibold text-on-background break-words min-w-0">
                  {m.display_name}
                </span>
                {lead && (
                  <span className="rounded-full bg-[#f3f1ea] text-[#1A5632] px-2 py-0.5 text-[11.5px] font-semibold leading-4">Lead</span>
                )}
                {!m.signed_up && <span className="text-[12px] leading-5 text-secondary">invited</span>}
              </div>
              {m.user_id !== viewerUserId && <ConnectButton communityId={teamId} memberId={m.member_id} compact />}
            </li>
          );
        })}
      </ul>
      {roster.length <= 1 && (
        <p className="text-[13px] leading-[1.5] text-secondary">
          Just you so far. Share the QR code above{isLead ? ", or invite people by email" : ""}.
        </p>
      )}
    </Card>
  );
}

// ── news ────────────────────────────────────────────────────────────────────

export function NewsList({ teamId, slug, items, isLead }: { teamId: string; slug: string; items: Announcement[]; isLead: boolean }) {
  const { busy, error, run } = useDo();
  if (items.length === 0) return null;
  return (
    <Card title="Team news" count={items.length}>
      <ul>
        {items.slice(0, 5).map((a) => (
          <li key={a.id} className={`${ROW} items-start ${busy === a.id ? "opacity-50" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="font-label-lg text-[14.5px] leading-6 font-semibold text-on-background break-words">{a.title}</p>
              {a.body && (
                <p className="font-body-md text-[14px] leading-[1.5] text-secondary whitespace-pre-line break-words">{a.body}</p>
              )}
              <p className="mt-1 text-[12.5px] leading-5 text-secondary">{shortDate(a.created_at)}</p>
            </div>
            {isLead && (
              <MoreMenu
                iconOnly
                className="shrink-0"
                items={[
                  {
                    label: "Delete",
                    danger: true,
                    onClick: () => {
                      if (window.confirm("Delete this news item?")) void run(a.id, () => deleteAnnouncementAction(teamId, a.id, slug));
                    },
                  },
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      <Err text={error} />
    </Card>
  );
}

