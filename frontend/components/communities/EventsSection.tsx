"use client";

// The Events view: upcoming events first (soonest first), then past ones greyed.
// A community admin gets "+ Add event" (title, date, time, place, link, short
// description) and Edit / Delete on each event. Members only read. The database
// policy (2026-11-03_community_events.sql) is the real gate; the controls here are
// shown to admins as a convenience. Times are Chicago time, the program's time zone.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEventAction, deleteEventAction, updateEventAction, type EventInput } from "@/app/communities/actions";
import MoreMenu from "@/components/MoreMenu";
import { eventBadge, eventDay, eventInputValues, eventTime, splitEvents } from "@/lib/server/communityHome/tiles";
import type { CommunityEvent } from "@/lib/server/communityEvents";
import { IconExternal, IconPlus } from "./CommunityIcons";

const INPUT =
  "w-full bg-white border border-outline-variant/60 rounded-lg px-3 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary";

const EMPTY: EventInput = { title: "", date: "", time: "", location: "", link: "", description: "" };

function fromEvent(e: CommunityEvent): EventInput {
  const { date, time } = eventInputValues(e.starts_at);
  return { title: e.title, date, time, location: e.location ?? "", link: e.link ?? "", description: e.description ?? "" };
}

function EventForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: EventInput;
  submitLabel: string;
  onSubmit: (v: EventInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<EventInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof EventInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onSubmit(v);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#e8e4da] bg-white p-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">Title</span>
        <input value={v.title} onChange={set("title")} maxLength={200} className={INPUT} autoFocus />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-label-md text-label-md text-on-background">Date</span>
          <input type="date" value={v.date} onChange={set("date")} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label-md text-label-md text-on-background">Time</span>
          <input type="time" value={v.time} onChange={set("time")} className={INPUT} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">Place (optional)</span>
        <input value={v.location} onChange={set("location")} maxLength={200} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">Link (optional)</span>
        <input type="url" value={v.link} onChange={set("link")} placeholder="https://" maxLength={500} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">Short description (optional)</span>
        <textarea value={v.description} onChange={set("description")} rows={3} maxLength={1000} className={INPUT} />
      </label>
      <p className="font-body-sm text-body-sm text-secondary">Times are Central Time (Birmingham).</p>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60">
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({
  e,
  past,
  isAdmin,
  onEdit,
  onDelete,
}: {
  e: CommunityEvent;
  past: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const b = eventBadge(e.starts_at);
  return (
    <li className={`rounded-2xl border border-[#e8e4da] bg-white p-3.5 flex gap-3 ${past ? "opacity-60" : ""}`}>
      <div className="w-[46px] shrink-0 rounded-[10px] border border-[#e8e4da] text-center overflow-hidden self-start">
        <b className={`block text-[10px] leading-4 py-0.5 text-white ${past ? "bg-secondary" : "bg-primary"}`}>{b.month}</b>
        <span className="block text-[17px] leading-6 font-bold py-0.5 text-on-background">{b.day}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-label-lg text-[15px] leading-6 font-semibold text-on-background break-words">{e.title}</p>
        <p className="text-[12.5px] leading-5 text-secondary">
          {eventDay(e.starts_at)} · {eventTime(e.starts_at)}
          {e.location ? ` · ${e.location}` : ""}
        </p>
        {e.description && <p className="mt-1 font-body-md text-body-md text-secondary whitespace-pre-line break-words">{e.description}</p>}
        {e.link && (
          <a
            href={e.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            Open link <IconExternal />
          </a>
        )}
      </div>
      {isAdmin && (
        <MoreMenu
          iconOnly
          className="shrink-0"
          items={[
            { label: "Edit", onClick: onEdit },
            { label: "Delete", danger: true, onClick: onDelete },
          ]}
        />
      )}
    </li>
  );
}

export default function EventsSection({
  communityId,
  slug,
  isAdmin,
  events,
  now,
}: {
  communityId: string;
  slug: string;
  isAdmin: boolean;
  events: CommunityEvent[];
  /** The server's "now" (ISO), so the list does not flip between server and browser. */
  now: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { upcoming, past } = splitEvents(events, new Date(now));

  const after = (res: { ok: true } | { ok: false; error: string }) => {
    if (res.ok) {
      setAdding(false);
      setEditing(null);
      router.refresh();
    }
    return res;
  };

  const remove = async (e: CommunityEvent) => {
    if (!window.confirm(`Delete "${e.title}"?`)) return;
    setError(null);
    const res = await deleteEventAction(communityId, slug, e.id);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  const list = (items: CommunityEvent[], isPast: boolean) =>
    items.map((e) =>
      editing === e.id ? (
        <li key={e.id}>
          <EventForm
            initial={fromEvent(e)}
            submitLabel="Save"
            onSubmit={async (v) => after(await updateEventAction(communityId, slug, e.id, v))}
            onCancel={() => setEditing(null)}
          />
        </li>
      ) : (
        <Row key={e.id} e={e} past={isPast} isAdmin={isAdmin} onEdit={() => setEditing(e.id)} onDelete={() => remove(e)} />
      )
    );

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && !adding && (
        <div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-primary inline-flex items-center gap-1 px-4 py-2 rounded-[10px] font-label-md text-label-md"
          >
            <IconPlus /> Add event
          </button>
        </div>
      )}
      {adding && <EventForm initial={EMPTY} submitLabel="Add event" onSubmit={async (v) => after(await createEventAction(communityId, slug, v))} onCancel={() => setAdding(false)} />}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      {events.length === 0 && !adding ? (
        <p className="rounded-2xl border-[1.5px] border-dashed border-outline-variant bg-white px-4 py-7 text-center font-body-md text-body-md text-secondary">
          No events yet.{isAdmin ? " Add the first talk or meetup." : " Talks and meetups will be listed here."}
        </p>
      ) : (
        <>
          {upcoming.length > 0 && <ul className="flex flex-col gap-2.5">{list(upcoming, false)}</ul>}
          {past.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <h3 className="font-label-md text-label-md text-secondary mt-2">Past events</h3>
              <ul className="flex flex-col gap-2.5">{list(past, true)}</ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
