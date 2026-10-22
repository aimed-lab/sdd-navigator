// "Today in biomedical research": four cards (type tag, title, one meta line) picked
// by pickToday() from data the landing already loaded.

import Link from "next/link";
import SectionHeading from "@/components/explore/SectionHeading";
import { TYPE_STYLES } from "@/lib/typeStyles";
import type { TodayCard } from "@/lib/server/explore/exploreLayout";

export default function TodayCards({ cards }: { cards: TodayCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="Today in biomedical research">
      <div className="flex items-end justify-between gap-3 mb-4">
        <SectionHeading title="Today in biomedical research" className="" />
        <Link href="/explore?category=news" className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0 pb-1">
          More →
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
        {cards.map((c) => {
          const t = TYPE_STYLES[c.tint];
          const body = (
            <>
              <span
                className="self-start px-2.5 py-0.5 rounded-full font-label-sm text-[11px] leading-tight"
                style={{ background: t.bg, color: t.fg }}
              >
                {c.tag}
              </span>
              <h3 className="font-title text-[18px] leading-snug font-medium text-on-background line-clamp-3 break-words">{c.title}</h3>
              {c.meta && <p className="mt-auto font-body-sm text-body-sm text-secondary line-clamp-1">{c.meta}</p>}
            </>
          );
          const cls =
            "rounded-2xl bg-white border border-outline-variant/30 p-5 flex flex-col gap-3 min-w-0 transition-colors ";
          return c.url ? (
            <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer" className={cls + "hover:border-primary/50"}>
              {body}
            </a>
          ) : (
            <div key={c.id} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
