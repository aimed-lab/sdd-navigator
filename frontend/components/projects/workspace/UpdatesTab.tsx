"use client";

// The Updates tab: announcements pinned on top, then the feed newest first. One
// primary button, "Post an update", opens a small form with a choice: Update,
// Ask for help (and Announcement for a lead or manager). A lead or manager can
// mark a help post resolved; the author, a lead or a manager can delete a post.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteUpdateAction, postUpdateAction, resolveHelpAction } from "@/app/projects/[id]/actions";
import MoreMenu from "@/components/MoreMenu";
import {
  UPDATE_BODY_MAX,
  arrangeUpdates,
  canDeleteUpdate,
  canResolve,
  postableKinds,
  type UpdateKind,
} from "@/lib/server/projectWorkspace/status";
import type { ProjectUpdate } from "@/lib/server/projectWorkspace/updates";

const KIND_LABEL: Record<UpdateKind, string> = {
  update: "Update",
  help: "Ask for help",
  announcement: "Announcement",
};

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

function PostCard({
  u,
  role,
  projectId,
  pinned,
  onError,
}: {
  u: ProjectUpdate;
  role: string;
  projectId: string;
  pinned?: boolean;
  onError: (m: string | null) => void;
}) {
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

  const items = [];
  if (canDeleteUpdate({ role, isAuthor: u.is_mine })) {
    items.push({
      label: "Delete post",
      danger: true,
      onClick: () => {
        if (window.confirm("Delete this post? This can't be undone.")) void run(() => deleteUpdateAction(projectId, u.id));
      },
    });
  }

  return (
    <article
      className={
        "rounded-xl border p-5 " +
        (pinned ? "bg-primary/5 border-primary/30" : "bg-white border-outline-variant/30")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 font-label-sm text-label-sm text-secondary">
          {pinned && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-on-primary">
              <span className="material-symbols-outlined text-[14px]">push_pin</span>
              Announcement
            </span>
          )}
          {u.kind === "help" && (
            <span
              className={
                "px-2 py-0.5 rounded-full " +
                (u.resolved_at ? "bg-surface-container text-secondary" : "bg-error/10 text-error")
              }
            >
              {u.resolved_at ? "Help resolved" : "Needs help"}
            </span>
          )}
          <span className="text-on-background">{u.author_name ?? "A team member"}</span>
          <span>{dateLabel(u.created_at)}</span>
        </div>
        {items.length > 0 && <MoreMenu items={items} />}
      </div>
      <p className="mt-3 font-body-md text-body-md text-on-background whitespace-pre-wrap break-words">{u.body}</p>
      {u.kind === "help" && canResolve(role) && (
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

export default function UpdatesTab({
  projectId,
  role,
  updates,
}: {
  projectId: string;
  /** The viewer's role on this project: lead, manager or member. */
  role: string;
  updates: ProjectUpdate[];
}) {
  const router = useRouter();
  const kinds = postableKinds(role);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<UpdateKind>("update");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { pinned, feed } = arrangeUpdates(updates);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await postUpdateAction(projectId, kind, body);
    setBusy(false);
    if (res.ok) {
      setBody("");
      setKind("update");
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <section className="flex flex-col gap-4">
        <p className="font-body-md text-body-md text-secondary">
          Share progress with your team and the program managers, or ask for help. Everyone on the project sees these posts.
        </p>
        {!open ? (
          <div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              <span className="material-symbols-outlined text-[20px]">add</span>
              Post an update
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex flex-col gap-3">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">What kind of post</legend>
              {kinds.map((k) => (
                <label
                  key={k}
                  className={
                    "px-4 py-2 rounded-full cursor-pointer font-label-md text-label-md transition-colors " +
                    (kind === k ? "bg-primary text-on-primary" : "bg-surface-container-low text-secondary hover:bg-surface-container")
                  }
                >
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </fieldset>
            <label className="sr-only" htmlFor="update-body">
              Your post
            </label>
            <textarea
              id="update-body"
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={UPDATE_BODY_MAX}
              disabled={busy}
              placeholder={
                kind === "help"
                  ? "What do you need help with? The first line is shown to the program managers."
                  : kind === "announcement"
                    ? "Write the announcement. It stays pinned at the top."
                    : "What happened this week?"
              }
              className="w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                  setOpen(false);
                  setError(null);
                }}
                className="font-label-md text-label-md text-secondary hover:text-primary"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {!open && error && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {pinned.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Announcements">
          {pinned.map((u) => (
            <PostCard key={u.id} u={u} role={role} projectId={projectId} pinned onError={setError} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3" aria-label="Updates">
        {feed.length === 0 ? (
          <p className="font-body-md text-body-md text-secondary">
            No updates yet. Click Post an update to share the first one.
          </p>
        ) : (
          feed.map((u) => <PostCard key={u.id} u={u} role={role} projectId={projectId} onError={setError} />)
        )}
      </section>
    </div>
  );
}
