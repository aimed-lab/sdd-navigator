// The pinned open call at the top of /collaborate. A STATIC tile, not a database
// post: it carries only the text and links below (all in lib/phgdhRoute.ts, so
// they can be swapped in one place). Server-safe.

import Link from "next/link";
import { PHGDH_LINKS } from "@/lib/phgdhRoute";
import { TYPE_STYLES } from "@/lib/typeStyles";

export default function OpenCallTile() {
  const t = TYPE_STYLES.news;
  return (
    <section
      aria-label="Pinned open call"
      className="tile p-6 md:p-8 mt-6 flex flex-col md:flex-row md:items-center gap-6 md:gap-10"
      style={{ background: t.bg }}
    >
      <div className="flex-1 min-w-0">
        <p className="type-label" style={{ color: "#C2410C" }}>
          Open call · PHGDH in Alzheimer&apos;s
        </p>
        <h2 className="mt-3 font-title text-[26px] md:text-[30px] leading-[1.2] font-medium text-on-background">
          Help validate PHGDH as an Alzheimer&apos;s drug target
        </h2>
        <p className="mt-3 font-body-lg text-body-lg text-on-background/70 max-w-2xl">
          An open pilot inviting researchers to contribute to validating PHGDH, with contributions
          credited openly.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 shrink-0">
        <a
          href={PHGDH_LINKS.join}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary inline-block px-6 py-3 rounded-lg font-label-md text-label-md"
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
        <Link
          href={PHGDH_LINKS.collection}
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          See the PHGDH collection →
        </Link>
      </div>
    </section>
  );
}
