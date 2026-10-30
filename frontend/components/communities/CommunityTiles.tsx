// The tiles under a community's banner (members): Announcements, Events, Members
// (Investigators on the SPARC community), Resources, Pinned (when there is a pinned
// resource) and, for admins, a dashed Manage tile. 3 across on a phone, 6 across on
// a desktop. A section tile links to ?view=<section>; the open one has a 2px UAB
// Green border. Pinned opens the pinned link itself. Server-safe.

import Link from "next/link";
import { IconBook, IconCalendar, IconFileCheck, IconMegaphone, IconSettings, IconUsers } from "./CommunityIcons";

export type TileKey = "announcements" | "events" | "members" | "resources" | "pinned" | "manage";

export type TileSpec = {
  key: TileKey;
  /** Desktop label; `short` is the phone label when it differs. */
  label: string;
  short?: string;
  small: string;
  badge?: string | null;
  /** A section link (?view=) or, for Pinned, the pinned link. */
  href: string;
  external?: boolean;
  dashed?: boolean;
};

const ICON = {
  announcements: IconMegaphone,
  events: IconCalendar,
  members: IconUsers,
  resources: IconBook,
  pinned: IconFileCheck,
  manage: IconSettings,
} as const;

const TILE =
  "relative text-center min-w-0 flex flex-col items-center basis-[calc((100%-20px)/3)] md:basis-[calc((100%-50px)/6)] grow-0 shrink-0 rounded-2xl bg-white px-1.5 pt-4 pb-3.5 md:pt-[18px] " +
  "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export default function CommunityTiles({ slug, view, tiles }: { slug: string; view: string | null; tiles: TileSpec[] }) {
  return (
    <nav aria-label="Community sections" className="flex flex-wrap justify-center gap-2.5">
      {tiles.map((t) => {
        const on = t.key !== "pinned" && view === t.key;
        const Icon = ICON[t.key];
        const body = (
          <>
            {t.badge && (
              <span className="absolute top-2.5 right-2.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-[14px] text-on-primary">
                {t.badge}
              </span>
            )}
            <span className="grid place-items-center shrink-0 w-[46px] h-[46px] rounded-[13px] bg-surface-container-low text-primary mb-[9px]" aria-hidden>
              <Icon />
            </span>
            <span className="block text-[14px] leading-[18px] font-bold text-on-background">
              {t.short ? (
                <>
                  <span className="md:hidden">{t.short}</span>
                  <span className="hidden md:inline">{t.label}</span>
                </>
              ) : (
                t.label
              )}
            </span>
            <span className="block mt-0.5 text-[11.5px] leading-4 text-secondary max-w-full truncate">{t.small}</span>
          </>
        );
        const cls = `${TILE} ${on ? "border-2 border-primary" : t.dashed ? "border border-dashed border-outline" : "border border-[#e8e4da]"}`;
        // Tapping the open tile again goes back to the community home.
        const href = on ? `/communities/${slug}` : t.href;
        return t.external ? (
          <a key={t.key} href={t.href} target="_blank" rel="noopener noreferrer" className={cls}>
            {body}
          </a>
        ) : (
          <Link key={t.key} href={href} scroll={false} aria-current={on ? "page" : undefined} className={cls}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}
