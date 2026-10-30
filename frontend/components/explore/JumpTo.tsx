// "Jump to": seven tiles straight to a full list, directly under the question
// box. They replace the old Browse tabs. Each tile is an icon, a name and one
// short line.

import Link from "next/link";
import { jumpTiles } from "@/lib/server/explore/exploreLayout";

export default function JumpTo({ episodeCount }: { episodeCount: number | null }) {
  return (
    <nav aria-label="Jump to" className="mt-8">
      <p className="mb-3 font-label-md text-label-md text-secondary">Or jump straight to</p>
      <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {jumpTiles(episodeCount).map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              className="h-full rounded-xl bg-white border border-outline-variant/30 hover:border-primary px-3.5 py-3 flex flex-col gap-1 transition-colors"
            >
              <span className="material-symbols-outlined text-primary text-[22px]">{t.icon}</span>
              <span className="font-label-lg text-label-lg text-on-background leading-tight">{t.title}</span>
              <span className="font-body-sm text-[12px] leading-snug text-secondary">{t.line}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
