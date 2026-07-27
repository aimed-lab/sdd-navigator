"use client";

// The inbox list. Client component for two reasons: the "Mark all as seen"
// control, and the optimistic status flip so a click feels immediate rather than
// waiting on a revalidate round-trip.
//
// It renders only what the server handed it. There is no fetching here and no
// user id anywhere in this file — inbox_requests() already scoped the rows to the
// signed-in owner, so this component cannot show the wrong person's mail even if
// it tried.
//
// CONTACT: `contact` is what the RESPONDER typed. It is displayed as text, and
// linkified as a mailto ONLY when it actually looks like a bare email address —
// the field accepts phones, handles and sentences, so assuming an email would
// produce broken links. Blank is normal and says so plainly, because "no reply
// route" is information the owner needs.

import { useState } from "react";
import Link from "next/link";
import { markSeenAction } from "@/app/inbox/actions";
import { INTEREST_LABELS, type InterestType } from "@/lib/collabTypes";
import type { InboxRequest } from "@/lib/server/inbox";

const INTEREST_ICONS: Record<InterestType, string> = {
  can_provide: "volunteer_activism",
  want_to_join: "group_add",
  want_to_use: "handyman",
  general: "chat_bubble",
};

/** A single bare email address and nothing else — conservative on purpose, so a
 *  phone number or "ping me on Slack" is never turned into a dead mailto link. */
const BARE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ContactLine({ contact }: { contact: string }) {
  const value = contact.trim();

  if (!value) {
    return (
      <p className="font-body-sm text-body-sm text-secondary italic">
        No contact provided — they didn&apos;t share a way to reply.
      </p>
    );
  }

  return (
    <p className="font-body-md text-body-md text-on-background break-words">
      <span className="material-symbols-outlined text-base align-middle mr-1 text-secondary">
        alternate_email
      </span>
      {BARE_EMAIL.test(value) ? (
        <a href={`mailto:${value}`} className="text-primary underline underline-offset-2">
          {value}
        </a>
      ) : (
        value
      )}
    </p>
  );
}

function RequestCard({ request }: { request: InboxRequest }) {
  const interest = (request.interest_type ?? "general") as InterestType;
  const isNew = request.status === "new";
  const who = request.responder_name?.trim() || "A researcher";
  const where = [request.responder_affiliation, request.responder_institution]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={
        "rounded-2xl border p-6 transition-colors " +
        (isNew
          ? "border-primary/40 bg-primary/[0.03]"
          : "border-outline-variant/40 bg-surface-container-lowest")
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-label-md text-label-md text-on-background">
            {request.responder_profile_slug ? (
              <Link
                href={`/researchers/${request.responder_profile_slug}`}
                className="text-primary underline underline-offset-2"
              >
                {who}
              </Link>
            ) : (
              who
            )}
          </h3>
          {where && (
            <p className="mt-0.5 font-body-sm text-body-sm text-secondary">{where}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          {isNew && (
            <span className="inline-block mb-1 px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm">
              New
            </span>
          )}
          <p className="font-body-sm text-body-sm text-secondary">
            {formatDate(request.created_at)}
          </p>
        </div>
      </div>

      {/* Which post this is about, and how they want to engage with it. */}
      <p className="mt-4 font-body-sm text-body-sm text-secondary">
        Re: <span className="text-on-background">{request.post_title}</span>
      </p>

      <p className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary-container text-primary font-label-sm text-label-sm">
        <span className="material-symbols-outlined text-base">{INTEREST_ICONS[interest]}</span>
        {INTEREST_LABELS[interest]}
      </p>

      {request.message.trim() && (
        <blockquote className="mt-4 pl-4 border-l-2 border-outline-variant/60 font-body-md text-body-md text-on-background whitespace-pre-wrap">
          {request.message}
        </blockquote>
      )}

      <div className="mt-5 pt-4 border-t border-outline-variant/30">
        <p className="font-label-sm text-label-sm text-secondary uppercase mb-1">Reach them at</p>
        <ContactLine contact={request.contact} />
      </div>
    </article>
  );
}

export default function InboxList({ requests }: { requests: InboxRequest[] }) {
  // Local copy so "Mark all as seen" can update the badges immediately. The
  // server is still the source of truth; this just avoids a visible lag.
  const [rows, setRows] = useState(requests);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unseenIds = rows.filter((r) => r.status === "new").map((r) => r.request_id);

  const markAll = async () => {
    if (busy || unseenIds.length === 0) return;
    setBusy(true);
    setError(null);

    const res = await markSeenAction(unseenIds);
    if (res.ok) {
      setRows((prev) =>
        prev.map((r) => (r.status === "new" ? { ...r, status: "seen" as const } : r))
      );
    } else {
      setError(res.error);
    }
    setBusy(false);
  };

  if (rows.length === 0) {
    return (
      <div className="text-center py-20 rounded-2xl border border-outline-variant/40">
        <span className="material-symbols-outlined text-5xl text-secondary/50">inbox</span>
        <h2 className="mt-4 font-headline-md text-headline-md text-on-background">
          Nothing here yet
        </h2>
        <p className="mt-2 mx-auto max-w-md font-body-md text-body-md text-secondary">
          When someone responds to one of your Collaborate posts, their message and
          contact details land here.
        </p>
        <Link
          href="/collaborate"
          className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
        >
          Go to the board
        </Link>
      </div>
    );
  }

  return (
    <div>
      {unseenIds.length > 0 && (
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={markAll}
            disabled={busy}
            className="btn-outline px-4 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {busy ? "Marking…" : `Mark all as seen (${unseenIds.length})`}
          </button>
        </div>
      )}

      {error && (
        <p className="mb-4 font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {rows.map((r) => (
          <RequestCard key={r.request_id} request={r} />
        ))}
      </div>
    </div>
  );
}
