"use client";

// The Discussions tab: threads (title + text) newest activity first, "Start a
// discussion" for any member, and, on a thread, the replies with a reply box.
// The author, a project lead or a site admin can delete. Plain text; links are
// clickable; no attachments.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createThreadAction, deleteReplyAction, deleteThreadAction, replyAction } from "@/app/projects/[id]/actions";
import MoreMenu from "@/components/MoreMenu";
import LinkedText from "./LinkedText";
import { THREAD_BODY_MAX, THREAD_TITLE_MAX, canDeleteThread, timeAgo } from "@/lib/server/projectWorkspace/colabofest";
import { tabHref } from "@/lib/server/projectWorkspace/workspace";
import type { Reply, Thread } from "@/lib/server/projectWorkspace/discussions";

const INPUT =
  "w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/30";

function replyWord(n: number): string {
  return `${n} ${n === 1 ? "reply" : "replies"}`;
}

export function DiscussionsList({
  projectId,
  threads,
  startOpen,
}: {
  projectId: string;
  threads: Thread[];
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!startOpen);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createThreadAction(projectId, title, body);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push(`${tabHref(projectId, "discussions")}&thread=${res.id}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <p className="font-body-md text-body-md text-secondary">
        Ask a question or share an idea. Everyone on your project sees these, and anyone on the team can reply.
      </p>
      {!open ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
            Start a discussion
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex flex-col gap-3">
          <label className="sr-only" htmlFor="thread-title">
            Title
          </label>
          <input
            id="thread-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={THREAD_TITLE_MAX}
            disabled={busy}
            placeholder="Title"
            className={INPUT}
          />
          <label className="sr-only" htmlFor="thread-body">
            Your message
          </label>
          <textarea
            id="thread-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={THREAD_BODY_MAX}
            disabled={busy}
            placeholder="What would you like to talk about?"
            className={INPUT}
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

      {threads.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary">No discussions yet. Say hello and start the first one.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`${tabHref(projectId, "discussions")}&thread=${t.id}`}
                className="block rounded-xl border border-outline-variant/30 bg-white p-5 hover:border-primary/40 transition-colors"
              >
                <span className="block font-label-lg text-[17px] text-on-background break-words">{t.title}</span>
                <span className="mt-1 block font-body-sm text-body-sm text-secondary">
                  {t.author_name ?? "A team member"} · {timeAgo(t.last_activity_at)} · {replyWord(t.reply_count)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ThreadView({
  projectId,
  thread,
  replies,
  role,
  isSiteAdmin,
}: {
  projectId: string;
  thread: Thread;
  replies: Reply[];
  role: string;
  isSiteAdmin: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await replyAction(projectId, thread.id, text);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setText("");
    router.refresh();
  };

  const remove = async (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    const res = await fn();
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    if (after) after();
    else router.refresh();
  };

  const threadItems = canDeleteThread({ isAuthor: thread.is_mine, role, isSiteAdmin })
    ? [
        {
          label: "Delete discussion",
          danger: true,
          onClick: () => {
            if (window.confirm("Delete this discussion and its replies? This can't be undone.")) {
              void remove(
                () => deleteThreadAction(projectId, thread.id),
                () => {
                  router.push(tabHref(projectId, "discussions"));
                  router.refresh();
                }
              );
            }
          },
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Link href={tabHref(projectId, "discussions")} className="inline-flex items-center gap-1 font-label-sm text-label-sm text-secondary hover:text-primary">
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        All discussions
      </Link>

      <article className="rounded-xl border border-outline-variant/30 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-title text-[22px] leading-snug font-medium text-on-background break-words">{thread.title}</h2>
          {threadItems.length > 0 && <MoreMenu items={threadItems} />}
        </div>
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          {thread.author_name ?? "A team member"} · {timeAgo(thread.created_at)}
        </p>
        <p className="mt-3 font-body-md text-body-md text-on-background whitespace-pre-wrap break-words">
          <LinkedText text={thread.body} />
        </p>
      </article>

      <section aria-label="Replies" className="flex flex-col gap-3">
        <h3 className="font-label-lg text-[16px] text-on-background">{replyWord(replies.length)}</h3>
        {replies.map((r) => {
          const items = canDeleteThread({ isAuthor: r.is_mine, role, isSiteAdmin })
            ? [
                {
                  label: "Delete reply",
                  danger: true,
                  onClick: () => {
                    if (window.confirm("Delete this reply?")) void remove(() => deleteReplyAction(projectId, r.id));
                  },
                },
              ]
            : [];
          return (
            <div key={r.id} className="rounded-xl bg-surface-container-lowest border border-outline-variant/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-label-sm text-label-sm text-secondary">
                  <span className="text-on-background">{r.author_name ?? "A team member"}</span> · {timeAgo(r.created_at)}
                </p>
                {items.length > 0 && <MoreMenu items={items} />}
              </div>
              <p className="mt-2 font-body-md text-body-md text-on-background whitespace-pre-wrap break-words">
                <LinkedText text={r.body} />
              </p>
            </div>
          );
        })}
      </section>

      <form onSubmit={send} className="flex flex-col gap-3">
        <label className="font-label-md text-label-md text-on-background" htmlFor="reply-body">
          Reply
        </label>
        <textarea
          id="reply-body"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={THREAD_BODY_MAX}
          disabled={busy}
          placeholder="Write a reply"
          className={INPUT}
        />
        {error && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60">
            {busy ? "Posting…" : "Reply"}
          </button>
        </div>
      </form>
    </div>
  );
}
