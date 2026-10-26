// The pinned open call under the cards on /collaborate: a slim banner, not a
// database post. Text and links live in lib/phgdhRoute.ts so they can be swapped
// in one place. Server-safe.

import { PHGDH_LINKS } from "@/lib/phgdhRoute";
import { TYPE_STYLES } from "@/lib/typeStyles";

export default function OpenCallTile() {
  const t = TYPE_STYLES.news;
  return (
    <section
      aria-label="Pinned open call"
      className="tile px-5 py-3 mt-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
      style={{ background: t.bg }}
    >
      <p className="flex-1 min-w-0 font-title text-[18px] leading-snug font-medium text-on-background">
        <span className="type-label mr-2" style={{ color: "#C2410C" }}>
          Open call
        </span>
        Help validate PHGDH as an Alzheimer&apos;s drug target
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 shrink-0">
        <a
          href={PHGDH_LINKS.join}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-block px-5 py-2 rounded-lg font-label-md text-label-md"
        >
          Join the call ↗
        </a>
        <a
          href={PHGDH_LINKS.patent}
          target="_blank"
          rel="noopener noreferrer"
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          Read about the pilot ↗
        </a>
      </div>
    </section>
  );
}
