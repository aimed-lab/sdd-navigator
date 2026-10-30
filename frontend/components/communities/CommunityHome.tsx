// The community home (a member's view): the pinned card, then two columns. Left,
// "Latest": announcements, upcoming events and recent joins mixed, newest first (six
// at most), with "Post announcement +" for admins. Right, "Upcoming" (the next three
// events with a date badge) and a short people list (five, "See all"). On a phone the
// columns stack. Server-safe.

import Link from "next/link";
import { initials } from "@/lib/server/communityHome/communityHome";
import { eventBadge, eventDay, eventTime, type LatestEntry } from "@/lib/server/communityHome/tiles";
import type { CommunityEvent } from "@/lib/server/communityEvents";
import { IconCalendar, IconMegaphone, IconUser } from "./CommunityIcons";

const ICON = { announcement: IconMegaphone, event: IconCalendar, join: IconUser } as const;

function Card({ title, link, children }: { title: string; link?: { href: string; label: string } | null; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e8e4da] bg-white px-[18px] py-4 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h2 className="font-title text-[18px] leading-6 text-on-background">{title}</h2>
        {link && (
          <Link href={link.href} className="font-label-md text-[12.5px] font-semibold text-primary hover:underline underline-offset-4 shrink-0">
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default function CommunityHome({
  slug,
  latest,
  isAdmin,
  upcoming,
  people,
  showEvents,
  showMembers,
  membersLabel,
}: {
  slug: string;
  latest: LatestEntry[];
  isAdmin: boolean;
  /** The next events, soonest first (at most three are shown). */
  upcoming: CommunityEvent[];
  people: { id: string; name: string; sub: string | null }[];
  showEvents: boolean;
  showMembers: boolean;
  membersLabel: string;
}) {
  const base = `/communities/${slug}`;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3.5 items-start">
      <Card title="Latest" link={isAdmin ? { href: `${base}?view=announcements&new=1`, label: "Post announcement +" } : null}>
        {latest.length === 0 ? (
          <p className="font-body-md text-body-md text-secondary">Nothing yet. New announcements and events show up here.</p>
        ) : (
          <ul>
            {latest.map((it) => {
              const Icon = ICON[it.kind];
              return (
                <li key={it.key} className="flex gap-3 py-2.5 border-t border-[#e8e4da] first:border-t-0 first:pt-0">
                  <span className="grid place-items-center shrink-0 w-8 h-8 rounded-[9px] bg-surface-container-low text-primary" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0">
                    <b className="block text-[13.5px] leading-5 font-bold text-on-background break-words">{it.title}</b>
                    <small className="block text-[12px] leading-4 text-secondary">{it.meta}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-3.5 min-w-0">
        {showEvents && (
          <Card title="Upcoming" link={{ href: `${base}?view=events`, label: "All events" }}>
            {upcoming.length === 0 ? (
              <p className="font-body-md text-body-md text-secondary">No events yet.</p>
            ) : (
              <ul>
                {upcoming.slice(0, 3).map((e) => {
                  const b = eventBadge(e.starts_at);
                  return (
                    <li key={e.id} className="flex gap-3 py-2.5 border-t border-[#e8e4da] first:border-t-0 first:pt-0">
                      <div className="w-11 shrink-0 rounded-[10px] border border-[#e8e4da] text-center overflow-hidden self-start">
                        <b className="block bg-primary text-on-primary text-[10px] leading-4 py-0.5">{b.month}</b>
                        <span className="block text-[17px] leading-6 font-bold py-0.5 text-on-background">{b.day}</span>
                      </div>
                      <div className="min-w-0 text-[13.5px] leading-5">
                        <span className="block text-on-background break-words">{e.title}</span>
                        <small className="block text-[12px] leading-4 text-secondary">
                          {eventTime(e.starts_at)}
                          {e.location ? ` · ${e.location}` : ` · ${eventDay(e.starts_at)}`}
                        </small>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {showMembers && (
          <Card title={membersLabel} link={{ href: `${base}?view=members`, label: "See all" }}>
            <ul>
              {people.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-1.5 text-[12.5px] min-w-0">
                  <span
                    className="grid place-items-center shrink-0 w-[34px] h-[34px] rounded-full bg-surface-container-low text-primary font-bold text-[12px]"
                    aria-hidden
                  >
                    {initials(m.name)}
                  </span>
                  <div className="min-w-0">
                    <span className="block text-[13.5px] leading-5 text-on-background truncate">{m.name}</span>
                    {m.sub && <small className="block text-[11.5px] leading-4 text-secondary truncate">{m.sub}</small>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
