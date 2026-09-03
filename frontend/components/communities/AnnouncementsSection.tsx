"use client";

// The community's Announcements section. Read is member-only, write is
// admin-only — enforced in the database (RLS: is_community_member for
// SELECT, is_community_admin for INSERT/UPDATE/DELETE — see
// database/migrations/2026-09-02_community_announcements.sql), not by
// hiding the create form here: a non-member never receives any rows in the
// first place (the page only fetches when isMember, same "avoid firing it
// for a viewer who can't see anything back" reasoning as listMemberRoster).
//
// AUTHOR NAME comes from `authorNames` (built in the page from
// listMemberRoster()/community_member_roster()), never from an email —
// same reasoning as the Members section itself: public.users' own SELECT
// policy would otherwise blank out a private-profile author's name, and
// showing their email as a fallback isn't the roster's contract for this
// section.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
  updateAnnouncementAction,
} from "@/app/communities/actions";
import type { Announcement } from "@/lib/server/communities";
import CollapsibleSection from "./CollapsibleSection";

type ActionResult = { ok: true } | { ok: false; error: string };

// Same relative/absolute cutover as PostCard's postedLabel
// (components/collaborate/PostCard.tsx) — no shared date util in this
// codebase, so it's copied rather than imported (see that file's own
// comment on why Intl alone covers both).
const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

function relativeLabel(iso: string): string {
  const date = new Date(iso);
  const diffMs = date.getTime() - Date.now();
  const age = Math.abs(diffMs);
  if (age >= MONTH_MS) return ABSOLUTE_DATE.format(date);
  if (age < MINUTE_MS) return "just now";
  if (age < HOUR_MS) return RELATIVE_TIME.format(Math.round(diffMs / MINUTE_MS), "minute");
  if (age < DAY_MS) return RELATIVE_TIME.format(Math.round(diffMs / HOUR_MS), "hour");
  if (age < WEEK_MS) return RELATIVE_TIME.format(Math.round(diffMs / DAY_MS), "day");
  return RELATIVE_TIME.format(Math.round(diffMs / WEEK_MS), "week");
}

/** Shared by both "New announcement" and "Edit" — same fields, same
 *  validation (title required, trimmed server-side too), different submit
 *  action and labels. */
function AnnouncementForm({
  initialTitle = "",
  initialBody = "",
  busyLabel,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initialTitle?: string;
  initialBody?: string;
  busyLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: { title: string; body: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !title.trim()) return;

    setSaving(true);
    setError(null);
    const res = await onSubmit({ title: title.trim(), body: body.trim() });
    if (res.ok) {
      router.refresh();
      onCancel();
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Announcement title"
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        aria-label="Announcement body"
        rows={4}
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
      />
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="btn-primary px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          {saving ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Same dialog shell as LeaveButton's LeaveConfirm
 *  (components/communities/LeaveButton.tsx) — confirm before a destructive
 *  action, not a native confirm(). */
function DeleteAnnouncementConfirm({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete "${title}"`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">warning</span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Delete this announcement?
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary truncate">{title}</p>
          </div>
        </div>

        {error && (
          <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnnouncementItem({
  announcement,
  authorName,
  communityId,
  slug,
  isAdmin,
}: {
  announcement: Announcement;
  authorName: string;
  communityId: string;
  slug: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (editing) {
    return (
      <AnnouncementForm
        initialTitle={announcement.title}
        initialBody={announcement.body}
        busyLabel="Saving…"
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={(input) => updateAnnouncementAction(communityId, announcement.id, slug, input)}
      />
    );
  }

  return (
    <>
      <article className="rounded-xl bg-surface-container-low p-4">
        <h3 className="font-headline-sm text-headline-sm text-on-background">
          {announcement.title}
        </h3>
        {announcement.body && (
          <p className="mt-2 font-body-md text-body-md text-secondary whitespace-pre-wrap">
            {announcement.body}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2 font-body-sm text-body-sm text-secondary/70">
          <span className="truncate">{authorName}</span>
          <span>·</span>
          <time dateTime={announcement.created_at}>{relativeLabel(announcement.created_at)}</time>
          {isAdmin && (
            <span className="ml-auto flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="font-label-sm text-label-sm text-secondary hover:text-error transition-colors"
              >
                Delete
              </button>
            </span>
          )}
        </div>
      </article>

      {confirmingDelete && (
        <DeleteAnnouncementConfirm
          title={announcement.title}
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            setConfirmingDelete(false);
            setDeleteError(null);
          }}
          onConfirm={async () => {
            setDeleting(true);
            setDeleteError(null);
            const res = await deleteAnnouncementAction(communityId, announcement.id, slug);
            if (res.ok) {
              router.refresh();
            } else {
              setDeleteError(res.error);
              setDeleting(false);
            }
          }}
        />
      )}
    </>
  );
}

export default function AnnouncementsSection({
  title,
  communityId,
  slug,
  defaultOpen,
  isAdmin,
  announcements,
  authorNames,
}: {
  title: string;
  communityId: string;
  slug: string;
  defaultOpen?: boolean;
  /** Every create/edit/delete control below is gated on this — the RLS
   *  policies (see the migration) are the real gate; this just decides
   *  whether to render the affordance at all. */
  isAdmin: boolean;
  announcements: Announcement[];
  /** user_id -> display name, from listMemberRoster()/
   *  community_member_roster() (built in the page) — never an email. */
  authorNames: Record<string, string>;
}) {
  const [creating, setCreating] = useState(false);

  // This component owns its own CollapsibleSection (rather than the page
  // wrapping it externally, like Members/the placeholder sections do)
  // because the header's "New announcement" button and the create form
  // below both need the SAME `creating` state — that state has to live in
  // one client component, and the header action has to reach it.
  return (
    <CollapsibleSection
      title={title}
      count={announcements.length}
      defaultOpen={defaultOpen}
      action={
        isAdmin && !creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm shrink-0"
          >
            New announcement
          </button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {isAdmin && creating && (
          <AnnouncementForm
            busyLabel="Posting…"
            submitLabel="Post"
            onCancel={() => setCreating(false)}
            onSubmit={(input) => createAnnouncementAction(communityId, slug, input)}
          />
        )}

        {announcements.length === 0 ? (
          <p className="font-body-md text-body-md text-secondary">Nothing here yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {announcements.map((a) => (
              <li key={a.id}>
                <AnnouncementItem
                  announcement={a}
                  authorName={authorNames[a.author_id] ?? "Unknown"}
                  communityId={communityId}
                  slug={slug}
                  isAdmin={isAdmin}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </CollapsibleSection>
  );
}
