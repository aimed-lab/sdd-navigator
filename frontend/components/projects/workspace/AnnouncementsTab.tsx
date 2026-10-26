"use client";

// The Announcements tab (Slice 2's "Updates", renamed). Announcements are posted,
// edited, pinned and deleted by a project lead or manager or a site admin;
// everyone on the project reads them. Pinned first (with a PINNED tag), then
// newest. Anyone on the project can also "Ask for help": those requests are
// listed under the announcements, and a lead or manager marks them resolved.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteUpdateAction,
  editAnnouncementAction,
  pinAnnouncementAction,
  postUpdateAction,
  resolveHelpAction,
} from "@/app/projects/[id]/actions";
import MoreMenu from "@/components/MoreMenu";
import LinkedText from "./LinkedText";
import { ANNOUNCEMENT_BODY_MAX, arrangeAnnouncements, canManageAnnouncements } from "@/lib/server/projectWorkspace/colabofest";
import { canDeleteUpdate, canResolve } from "@/lib/server/projectWorkspace/status";
import type { ProjectUpdate } from "@/lib/server/projectWorkspace/updates";

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

const TEXTAREA =
  "w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30";

function Announcement({
  u,
  projectId,
  canManage,
  onError,
}: {
  u: ProjectUpdate;
  projectId: string;
  canManage: boolean;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(u.body);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    onError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else onError(res.error ?? "Something went wrong.");
  };

  const items = canManage
    ? [
        { label: "Edit", onClick: () => { setDraft(u.body); setEditing(true); } },
        { label: u.pinned ? "Unpin" : "Pin to the top", onClick: () => void run(() => pinAnnouncementAction(projectId, u.id, !u.pinned)) },
        {
          label: "Delete",
          danger: true,
          onClick: () => {
            if (window.confirm("Delete this announcement? This can't be undone.")) void run(() => deleteUpdateAction(projectId, u.id));
          },
        },
      ]
    : [];

  return (
    <article className={"rounded-xl border p-5 " + (u.pinned ? "bg-primary/5 border-primary/30" : "bg-white border-outline-variant/30")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 font-label-sm text-label-sm text-secondary">
          {u.pinned && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-on-primary uppercase tracking-wider">
              <span className="material-symbols-outlined text-[14px]">push_pin</span>
              Pinned
            </span>
          )}
          <span className="text-on-background">{u.author_name ?? "SPARC team"}</span>
          <span>{dateLabel(u.created_at)}</span>
          {u.edited_at && <span>(edited)</span>}
        </div>
        {items.length > 0 && <MoreMenu items={items} />}
      </div>
      {editing ? (
        <div className="mt-3 flex flex-col gap-3">
          <label className="sr-only" htmlFor={`edit-${u.id}`}>
            Edit announcement
          </label>
          <textarea
            id={`edit-${u.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={ANNOUNCEMENT_BODY_MAX}
            disabled={busy}
            className={TEXTAREA}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => editAnnouncementAction(projectId, u.id, draft))}
              className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(false)} className="font-label-md text-label-md text-secondary hover:text-primary">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 font-body-md text-body-md text-on-background whitespace-pre-wrap break-words">
          <LinkedText text={u.body} />
        </p>
      )}
    </article>
  );
}

function HelpPost({ u, role, projectId, onError }: { u: ProjectUpdate; role: string; projectId: string; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    onError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) router.refresh();
    else onError(res.error ?? "Something went wrong.");
  };
  const items = canDeleteUpdate({ role, isAuthor: u.is_mine })
    ? [
        {
          label: "Delete request",
          danger: true,
          onClick: () => {
            if (window.confirm("Delete this request? This can't be undone.")) void run(() => deleteUpdateAction(projectId, u.id));
          },
        },
      ]
    : [];
  return (
    <article className="rounded-xl border border-outline-variant/30 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 font-label-sm text-label-sm text-secondary">
          <span className={"px-2 py-0.5 rounded-full " + (u.resolved_at ? "bg-surface-container text-secondary" : "bg-error/10 text-error")}>
            {u.resolved_at ? "Help resolved" : "Needs help"}
          </span>
          <span className="text-on-background">{u.author_name ?? "A team member"}</span>
          <span>{dateLabel(u.created_at)}</span>
        </div>
        {items.length > 0 && <MoreMenu items={items} />}
      </div>
      <p className="mt-3 font-body-md text-body-md text-on-background whitespace-pre-wrap break-words">
        <LinkedText text={u.body} />
      </p>
      {canResolve(role) && (
        <div className="mt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => resolveHelpAction(projectId, u.id, !u.resolved_at))}
            className="btn-outline px-4 py-1.5 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
          >
            {u.resolved_at ? "Reopen" : "Mark as resolved"}
          </button>
        </div>
      )}
    </article>
  );
}

export default function AnnouncementsTab({
  projectId,
  role,
  isSiteAdmin,
  updates,
}: {
  projectId: string;
  /** The viewer's role on this project: lead, manager or member. */
  role: string;
  isSiteAdmin: boolean;
  updates: ProjectUpdate[];
}) {
  const router = useRouter();
  const canManage = canManageAnnouncements({ role, isSiteAdmin });
  const [form, setForm] = useState<null | "announcement" | "help">(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const announcements = arrangeAnnouncements(updates.filter((u) => u.kind === "announcement"));
  const help = updates
    .filter((u) => u.kind === "help")
    .sort((a, b) => Number(!!a.resolved_at) - Number(!!b.resolved_at) || b.created_at.localeCompare(a.created_at));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !form) return;
    setBusy(true);
    setError(null);
    const res = await postUpdateAction(projectId, form, body);
    setBusy(false);
    if (res.ok) {
      setBody("");
      setForm(null);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <section className="flex flex-col gap-4">
        <p className="font-body-md text-body-md text-secondary">
          {canManage
            ? "News and deadlines for the whole team. Pinned announcements stay at the top."
            : "News and deadlines from the SPARC team."}
        </p>
        {form === null ? (
          <div className="flex flex-wrap gap-3">
            {canManage && (
              <button
                type="button"
                onClick={() => setForm("announcement")}
                className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
                Post an announcement
              </button>
            )}
            <button
              type="button"
              onClick={() => setForm("help")}
              className="btn-outline inline-flex items-center gap-2 px-5 py-3 rounded-lg font-label-md text-label-md"
            >
              <span className="material-symbols-outlined text-[20px]">support</span>
              Ask for help
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex flex-col gap-3">
            <label className="font-label-md text-label-md text-on-background" htmlFor="announcement-body">
              {form === "announcement" ? "New announcement" : "Ask for help"}
            </label>
            <textarea
              id="announcement-body"
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={ANNOUNCEMENT_BODY_MAX}
              disabled={busy}
              placeholder={
                form === "help"
                  ? "What do you need help with? The first line is shown to the SPARC team."
                  : "Write the announcement."
              }
              className={TEXTAREA}
            />
            {error && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60">
                {busy ? "Posting…" : "Post"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setForm(null);
                  setError(null);
                }}
                className="font-label-md text-label-md text-secondary hover:text-primary"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {form === null && error && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Announcements">
        {announcements.length === 0 ? (
          <p className="font-body-md text-body-md text-secondary">No announcements yet.</p>
        ) : (
          announcements.map((u) => <Announcement key={u.id} u={u} projectId={projectId} canManage={canManage} onError={setError} />)
        )}
      </section>

      {help.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Help requests">
          <h2 className="font-headline-sm text-headline-sm text-on-background">Help requests</h2>
          {help.map((u) => (
            <HelpPost key={u.id} u={u} role={role} projectId={projectId} onError={setError} />
          ))}
        </section>
      )}
    </div>
  );
}
