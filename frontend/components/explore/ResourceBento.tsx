"use client";

// Pastel tiles for tools and datasets. Each tile: type label, monogram, serif
// name, one-line description, up to two small tags. 4 columns on desktop with
// deterministic spans by index (item 0 is 2x2, items 4 and 9 are 2 columns
// wide; grid-auto-flow: dense backfills the gaps). One column, no spans, on
// phones.

import SaveButton from "@/components/explore/SaveButton";
import { curatedToExploreItem, type CuratedItem } from "@/lib/curated";
import { TYPE_STYLES, typeKeyForKind } from "@/lib/typeStyles";
import type { ExploreItem } from "@/types/explore";

export type BentoTile = {
  id: string;
  kind: string; // "tool" | "dataset" (any other kind falls back to the neutral tint)
  name: string;
  description: string | null;
  url: string | null;
  tags: string[];
  /** Extra line shown on the large tile only, e.g. "Cheminformatics · BSD-3-Clause". */
  meta?: string | null;
};

export function curatedTile(item: CuratedItem, kind: "tool" | "dataset"): BentoTile {
  const e = curatedToExploreItem(item, kind);
  return {
    id: e.id,
    kind,
    name: item.name,
    description: item.oneLine,
    url: item.url,
    tags: item.tags,
    meta: [item.category, item.license].filter(Boolean).join(" · ") || null,
  };
}

export function liveTile(item: ExploreItem): BentoTile {
  return {
    id: item.id,
    kind: item.kind,
    name: item.title,
    description: item.summary?.trim() || null,
    url: item.url,
    tags: [],
  };
}

function spanClass(index: number): string {
  if (index === 0) return "md:col-span-2 md:row-span-2";
  if (index === 4 || index === 9) return "md:col-span-2";
  return "";
}

function Tile({ tile, index }: { tile: BentoTile; index: number }) {
  const large = index === 0;
  const t = TYPE_STYLES[typeKeyForKind(tile.kind)];
  const monogram = (tile.name.trim()[0] ?? "?").toUpperCase();

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {t.label}
        </span>
        <SaveButton />
      </div>

      <div className={"flex items-center gap-2.5 " + (large ? "mt-5" : "mt-2")}>
        <span
          aria-hidden
          className="shrink-0 w-6 h-6 rounded-md bg-white/60 flex items-center justify-center text-[13px] font-semibold"
          style={{ color: t.fg }}
        >
          {monogram}
        </span>
        <h3
          className={
            "font-title font-medium text-on-background leading-tight " +
            (large ? "text-[30px] line-clamp-3" : "text-[18px] truncate")
          }
        >
          {tile.name}
        </h3>
      </div>

      {tile.description && (
        <p
          className={
            "mt-1.5 text-on-background/70 " +
            (large ? "text-[15px] leading-relaxed line-clamp-6 mt-3" : "text-[13px] truncate")
          }
        >
          {tile.description}
        </p>
      )}

      {large && tile.meta && (
        <p className="mt-3 text-[13px] text-on-background/60">{tile.meta}</p>
      )}

      {tile.tags.length > 0 && (
        <div className="mt-auto pt-2 flex gap-1.5 overflow-hidden">
          {tile.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full bg-white/55 text-[11px] whitespace-nowrap"
              style={{ color: t.fg }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </>
  );

  const cls =
    "tile group flex flex-col p-4 min-h-[140px] min-w-0 overflow-hidden " +
    (large ? "md:p-6 " : "") +
    spanClass(index);
  return tile.url ? (
    <a
      href={tile.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      style={{ background: t.bg }}
    >
      {inner}
    </a>
  ) : (
    <div className={cls} style={{ background: t.bg }}>
      {inner}
    </div>
  );
}

export default function ResourceBento({ tiles }: { tiles: BentoTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:auto-rows-[140px] md:[grid-auto-flow:dense]">
      {tiles.map((tile, i) => (
        <Tile key={tile.id} tile={tile} index={i} />
      ))}
    </div>
  );
}
