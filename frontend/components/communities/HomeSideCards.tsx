// Right column of the community Home tab: upcoming events (an empty state for
// now), "Members working on" (name + the focus each member set in this
// community), and a placeholder for the weekly email digest.

import Link from "next/link";
import { initials } from "@/lib/server/communityHome/communityHome";
import type { SimilarMember } from "@/lib/server/communityHome/similarMembers";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl glass-panel p-5 flex flex-col gap-3">
      <h2 className="font-headline-sm text-headline-sm text-on-background">{title}</h2>
      {children}
    </section>
  );
}

export function UpcomingEventsCard() {
  return (
    <Card title="Upcoming events">
      <p className="font-body-md text-body-md text-secondary">No events yet. When an admin adds a talk or meetup, it shows up here.</p>
    </Card>
  );
}

export function MembersWorkingOnCard({
  rows,
  membersHref,
  similar = null,
  focusHref = null,
}: {
  rows: { id: string; name: string; focus: string }[];
  /** Link to the Members tab; omitted when the viewer can't open it. */
  membersHref: string | null;
  /** The viewer's closest members (they have a focus and are a member), or null
   *  for today's card. */
  similar?: SimilarMember[] | null;
  /** For a member with no focus yet: where to add it. Shows the invitation line. */
  focusHref?: string | null;
}) {
  if (similar) {
    return (
      <Card title="What members are working on">
        {similar.length === 0 ? (
          <p className="font-body-md text-body-md text-secondary">
            Nobody has shared a research focus close to yours yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {similar.map((m) => (
              <li key={m.id} className="flex items-start gap-3 min-w-0">
                <span
                  aria-hidden
                  className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-label-sm text-[11px] font-semibold shrink-0"
                >
                  {initials(m.name)}
                </span>
                <div className="min-w-0">
                  <div className="font-label-md text-label-md text-on-background truncate">{m.name}</div>
                  {m.focus && <div className="font-body-sm text-body-sm text-secondary line-clamp-2">{m.focus}</div>}
                  {m.reason && <div className="font-body-sm text-body-sm text-primary">{m.reason}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {membersHref && (
          <Link href={membersHref} className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4">
            See all members
          </Link>
        )}
      </Card>
    );
  }

  return (
    <Card title="What members are working on">
      {focusHref && (
        <Link href={focusHref} className="font-body-sm text-body-sm text-primary hover:underline underline-offset-4">
          Add your research focus to find people near your work
        </Link>
      )}
      {rows.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary">
          Nobody has shared their research focus yet. Add yours to start.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id} className="flex items-start gap-3 min-w-0">
              <span
                aria-hidden
                className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-label-sm text-[11px] font-semibold shrink-0"
              >
                {initials(m.name)}
              </span>
              <div className="min-w-0">
                <div className="font-label-md text-label-md text-on-background truncate">{m.name}</div>
                <div className="font-body-sm text-body-sm text-secondary line-clamp-2">{m.focus}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {membersHref && (
        <Link href={membersHref} className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4">
          See all members
        </Link>
      )}
    </Card>
  );
}

export function DigestCard() {
  return (
    <section
      aria-label="Weekly AI digest by email (coming soon)"
      className="rounded-2xl border border-dashed border-outline-variant/60 p-5 flex flex-col gap-2 opacity-80"
    >
      <span className="material-symbols-outlined text-secondary">mark_email_unread</span>
      <h2 className="font-headline-sm text-headline-sm text-on-background">Weekly AI digest by email</h2>
      <p className="font-body-sm text-body-sm text-secondary">Coming soon.</p>
    </section>
  );
}
