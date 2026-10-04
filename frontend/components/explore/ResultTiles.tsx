"use client";

// Tile-style cards for the result types that have no dedicated editorial
// component: clinical trials (TrialTile), and the generic ResultTile for gene
// sets, compounds, targets, people, lab resources, episodes, etc. They replace
// the old ItemCard on Explore and search pages: tint, 14px radius, no top
// border, serif title. Missing fields are hidden.

import SaveButton from "@/components/explore/SaveButton";
import { kindLabel, relativeTime, TYPE_STYLES, typeKeyForKind } from "@/lib/typeStyles";
import type { ExploreItem, TrialRaw } from "@/types/explore";

export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start";

// Status colors for a trial's own ClinicalTrials.gov status text.
function statusColor(status: string): string {
  if (status === "RECRUITING") return "#1F6B3A";
  if (status === "TERMINATED" || status === "WITHDRAWN" || status === "SUSPENDED") return "#B3261E";
  return "inherit";
}

function TileShell({ item, children }: { item: ExploreItem; children: React.ReactNode }) {
  const t = TYPE_STYLES[typeKeyForKind(item.kind)];
  const cls = "tile group block p-5";
  // The save button sits inside the link; SaveButton stops the click from
  // following it.
  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      style={{ background: t.bg }}
    >
      {children}
    </a>
  ) : (
    <div className={cls} style={{ background: t.bg }}>
      {children}
    </div>
  );
}

export function ResultTile({ item, projectId }: { item: ExploreItem; projectId?: string }) {
  const t = TYPE_STYLES[typeKeyForKind(item.kind)];
  const when = relativeTime(item.date_iso);
  const summary = item.summary?.trim();
  return (
    <TileShell item={item}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {kindLabel(item.kind)}
        </span>
        <SaveButton item={item} projectId={projectId} />
      </div>
      <h3 className="mt-3 font-title text-[20px] leading-tight font-medium text-on-background line-clamp-3">
        {item.title}
      </h3>
      {summary && (
        <p className="mt-1.5 text-[13px] leading-snug text-on-background/70 line-clamp-3">
          {summary}
        </p>
      )}
      {when && (
        <p className="mt-3 text-xs text-on-background/55" suppressHydrationWarning>
          {when}
        </p>
      )}
    </TileShell>
  );
}

export function TrialTile({ item, projectId }: { item: ExploreItem; projectId?: string }) {
  const t = TYPE_STYLES[typeKeyForKind("trial")];
  const raw = (item.raw ?? {}) as TrialRaw;
  const meta = [raw.nct_id, raw.phase].filter(Boolean).join(" · ");
  return (
    <TileShell item={item}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {kindLabel("trial")}
          {raw.overall_status && (
            <>
              {" · "}
              <span style={{ color: statusColor(raw.overall_status) }}>
                {raw.overall_status.replace(/_/g, " ")}
              </span>
            </>
          )}
        </span>
        <SaveButton item={item} projectId={projectId} />
      </div>
      <h3 className="mt-3 font-title text-[20px] leading-tight font-medium text-on-background line-clamp-4">
        {item.title}
      </h3>
      {meta && <p className="mt-2 text-xs text-on-background/60">{meta}</p>}
      {/* Verbatim from ClinicalTrials.gov, never paraphrased or summarised. */}
      {raw.why_stopped && (
        <p className="mt-2 text-[13px] leading-snug italic text-on-background/75">
          &ldquo;{raw.why_stopped}&rdquo;
        </p>
      )}
    </TileShell>
  );
}
