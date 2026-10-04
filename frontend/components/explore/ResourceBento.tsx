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
  /** Overrides the type label (e.g. "Reference"). Tint still follows `kind`. */
  label?: string;
  /** The underlying result, so the bookmark can save it into a project. */
  item?: ExploreItem;
  /** Marks a link that leaves the site: shows a ↗ after the name. */
  external?: boolean;
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
    item: e,
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
    item,
  };
}

function spanClass(index: number): string {
  if (index === 0) return "md:col-span-2 md:row-span-2";
  if (index === 4 || index === 9) return "md:col-span-2";
  return "";
}

function Tile({
  tile,
  index,
  flat,
  projectId,
}: {
  tile: BentoTile;
  index: number;
  flat: boolean;
  projectId?: string;
}) {
  const large = !flat && index === 0;
  const t = TYPE_STYLES[typeKeyForKind(tile.kind)];
  const tags = tile.tags.slice(0, 2);

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {tile.label ?? t.label}
        </span>
        <SaveButton item={tile.item} projectId={projectId} />
      </div>

      <h3
        className={
          "font-title font-medium text-on-background leading-tight " +
          (large ? "mt-4 text-[30px]" : "mt-1.5 text-[18px] truncate")
        }
      >
        {tile.name}
        {tile.external && <span aria-hidden> ↗</span>}
      </h3>

      {tile.description && (
        <p
          className={
            "text-on-background/70 " +
            (large
              ? "mt-3 text-[15px] leading-relaxed"
              : "mt-1 text-[13px] leading-[1.3] line-clamp-2")
          }
        >
          {tile.description}
        </p>
      )}

      {large && tile.meta && (
        <p className="mt-3 text-[13px] text-on-background/60">{tile.meta}</p>
      )}

      {tags.length > 0 && (
        <div className={"flex gap-1.5 overflow-hidden " + (large ? "mt-4" : "mt-auto pt-1.5")}>
          {tags.map((tag) => (
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

      {large && tile.url && (
        <p
          className="mt-auto pt-5 font-label-md text-label-md group-hover:underline underline-offset-4"
          style={{ color: t.fg }}
        >
          Open ↗
        </p>
      )}
    </>
  );

  const cls =
    "tile group flex flex-col p-3.5 min-h-[140px] min-w-0 overflow-hidden " +
    (large ? "md:p-6 " : "") +
    (flat ? "" : spanClass(index));
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

export default function ResourceBento({
  tiles,
  flat = false,
  projectId,
}: {
  tiles: BentoTile[];
  /** No spans: uniform tiles (for short lists such as reference links). */
  flat?: boolean;
  projectId?: string;
}) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:auto-rows-[minmax(140px,auto)] md:[grid-auto-flow:dense]">
      {tiles.map((tile, i) => (
        <Tile key={tile.id} tile={tile} index={i} flat={flat} projectId={projectId} />
      ))}
    </div>
  );
}
