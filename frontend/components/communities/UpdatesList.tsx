// "Updates" on the community Home tab: announcements and the Explore feed in
// one list, newest first, each with a type tag (same tinted chips as the
// assistant's source cards). `linked` is false for a non-member: the feed is
// look-only for them, the same rule ExploreSection applies.

import Link from "next/link";
import type { UpdateEntry } from "@/lib/server/communityHome/communityHome";

function Row({ u, linked }: { u: UpdateEntry; linked: boolean }) {
  const title = (
    <span className="font-label-lg text-label-lg text-on-background break-words">{u.title}</span>
  );
  return (
    <li className="py-4 first:pt-0 last:pb-0 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="px-2 py-0.5 rounded-full font-label-sm text-[11px] leading-tight"
          style={{ background: `var(--type-${u.tint}-bg)`, color: `var(--type-${u.tint}-fg)` }}
        >
          {u.tag}
        </span>
        <span className="font-body-sm text-body-sm text-secondary">
          {[u.source, u.dateLabel].filter(Boolean).join(" · ")}
        </span>
      </div>
      {linked && u.url ? (
        <a href={u.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline underline-offset-4">
          {title}
        </a>
      ) : (
        title
      )}
      {u.body && <p className="font-body-sm text-body-sm text-secondary line-clamp-2">{u.body}</p>}
    </li>
  );
}

export default function UpdatesList({
  updates,
  linked,
  showJoinPrompt,
  joinHref,
}: {
  updates: UpdateEntry[];
  linked: boolean;
  /** Signed-out / non-member: invite them to join for updates. */
  showJoinPrompt: boolean;
  joinHref: string;
}) {
  return (
    <section aria-label="Updates" className="rounded-2xl glass-panel p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-headline-sm text-headline-sm text-on-background">Updates</h2>
        {showJoinPrompt && (
          <Link href={joinHref} className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4">
            Join to get updates
          </Link>
        )}
      </div>

      {updates.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary">
          {showJoinPrompt
            ? "Join to get this community's announcements and new papers, trials and tools as they arrive."
            : "Nothing yet. Announcements and new findings from this community's Explore feed show up here."}
        </p>
      ) : (
        <ul className="divide-y divide-outline-variant/30">
          {updates.map((u) => (
            <Row key={u.id} u={u} linked={linked} />
          ))}
        </ul>
      )}
    </section>
  );
}
