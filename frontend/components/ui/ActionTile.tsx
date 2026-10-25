"use client";

// One action card, shared by the team page ("What do you want to do?") and the
// /start welcome page. A white card with a tinted icon square, a title, one
// line of description and an action line in the tone colour. The whole card
// is the click target: a button (opens a panel), a link, or, when it holds
// its own links (the "Your teams" list), a plain card.
//
// Colours are inline because each tone is a fixed pair (tinted background for
// the icon square, strong colour for the icon, action line, hover border and
// open ring). Hover: border takes the tone, lifts 2px, soft shadow.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type Tone = "blue" | "amber" | "rose" | "green";

export const TONES: Record<Tone, { bg: string; fg: string }> = {
  blue: { bg: "#e6ecfb", fg: "#2c4a9a" },
  amber: { bg: "#fef3c7", fg: "#b45309" },
  rose: { bg: "#fde8e6", fg: "#b42318" },
  green: { bg: "#d6efdc", fg: "#166534" },
};

export default function ActionTile({
  icon,
  title,
  description,
  action,
  tone,
  featured = false,
  badge,
  active = false,
  onClick,
  href,
  expanded,
  children,
}: {
  icon: string;
  title: string;
  description?: string;
  /** The action line at the bottom, e.g. "Add pages →". */
  action?: string;
  tone: Tone;
  /** Light green card with a green border (the tile to look at first). */
  featured?: boolean;
  /** Small badge next to the title, e.g. "AI". */
  badge?: string;
  /** Its panel is open: 2px border in the tone. */
  active?: boolean;
  onClick?: () => void;
  href?: string;
  /** aria-expanded for a tile that opens a panel. */
  expanded?: boolean;
  /** Extra content inside the card (a list of links). With no href or onClick the card is a plain div. */
  children?: ReactNode;
}) {
  const { bg, fg } = TONES[tone];
  const style = {
    "--tone": fg,
    ...(featured && !active ? { background: "#e9f5ec", borderColor: "#cfe6d5" } : {}),
    ...(active ? { borderColor: fg, borderWidth: 2, padding: 19 } : {}),
  } as CSSProperties;

  const cls =
    "group relative text-left w-full min-h-[150px] min-w-0 flex flex-col gap-2 rounded-2xl border border-[#e8e4da] bg-white p-5 " +
    "transition duration-150 hover:-translate-y-0.5 hover:border-[color:var(--tone)] hover:shadow-[0_8px_24px_rgba(40,36,28,0.1)] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tone)] focus-visible:ring-offset-2";

  const inner = (
    <>
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: featured ? "#cfe6d5" : bg, color: fg }}
        aria-hidden
      >
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-label-lg text-[16px] leading-6 font-semibold text-on-background break-words">{title}</span>
        {badge && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide"
            style={{ background: fg, color: "#fff" }}
          >
            {badge}
          </span>
        )}
      </span>
      {description && (
        <span className="font-body-sm text-[13.5px] leading-[1.5] text-secondary break-words">{description}</span>
      )}
      {children}
      {action && (
        <span className="mt-auto pt-1 text-[13.5px] font-semibold leading-6" style={{ color: fg }}>
          {action}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cls} style={style}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-expanded={expanded} className={cls} style={style}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} style={style}>
      {inner}
    </div>
  );
}
