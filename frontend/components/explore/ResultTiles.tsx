"use client";

// Tile-style cards for the result types that have no dedicated editorial
// component: clinical trials (TrialTile), and the generic ResultTile for gene
// sets, compounds, targets, people, lab resources, episodes, etc. They replace
// the old ItemCard on Explore and search pages: tint, 14px radius, no top
// border, serif title. Missing fields are hidden.

import SaveButton from "@/components/explore/SaveButton";
import { kindLabel, relativeTime, TYPE_STYLES, typeKeyForKind } from "@/lib/typeStyles";
import type { ApprovalRaw, ExploreItem, GrantRaw, TrialRaw } from "@/types/explore";

export const TILE_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start";

// Status colors for a trial's own ClinicalTrials.gov status text.
function statusColor(status: string): string {
  if (status === "RECRUITING") return "#1A5632";
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

export function ResultTile({
  item,
  projectId,
  hideSave = false,
}: {
  item: ExploreItem;
  projectId?: string;
  /** Leave out the bookmark (wiki pages have nothing to save into). */
  hideSave?: boolean;
}) {
  const t = TYPE_STYLES[typeKeyForKind(item.kind)];
  const when = relativeTime(item.date_iso);
  const summary = item.summary?.trim();
  return (
    <TileShell item={item}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {kindLabel(item.kind)}
        </span>
        {!hideSave && <SaveButton item={item} projectId={projectId} />}
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

// Grants.gov dates are MMDDYYYY strings (MM/DD/YYYY is accepted too).
// Unparseable -> null, so the tile shows no deadline rather than a wrong one.
function formatGrantDate(value: string | null | undefined): string | null {
  const m = value?.trim().match(/^(\d{2})\/?(\d{2})\/?(\d{4})$/);
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function GrantTile({
  item,
  projectId,
  hideSave = false,
}: {
  item: ExploreItem;
  projectId?: string;
  /** Leave out the bookmark (wiki pages have nothing to save into). */
  hideSave?: boolean;
}) {
  const t = TYPE_STYLES[typeKeyForKind("grant")];
  const raw = (item.raw ?? {}) as GrantRaw;
  const funder = raw.agency?.trim() || item.summary?.trim();
  const closes = formatGrantDate(raw.close_date);
  const deadline = closes
    ? `Closes ${closes}`
    : raw.status?.toLowerCase() === "forecasted"
      ? "Forecasted"
      : null;
  // Not a TileShell: the whole tile is not a link here, so the "Apply" link
  // inside it is not nested in another anchor.
  return (
    <div className="tile group block p-5" style={{ background: t.bg }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {kindLabel("grant")}
        </span>
        {!hideSave && <SaveButton item={item} projectId={projectId} />}
      </div>
      <h3 className="mt-3 font-title text-[20px] leading-tight font-medium text-on-background line-clamp-3">
        {item.title}
      </h3>
      {funder && (
        <p className="mt-1.5 text-[13px] leading-snug text-on-background/70 line-clamp-2">{funder}</p>
      )}
      {deadline && <p className="mt-2 text-xs text-on-background/60">{deadline}</p>}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block font-label-md text-label-md hover:underline underline-offset-4"
          style={{ color: t.fg }}
        >
          Apply ↗
        </a>
      )}
    </div>
  );
}

// openFDA approval dates are YYYYMMDD. Unparseable -> null (no date shown).
function parseYmd(value: string | null | undefined): Date | null {
  const m = value?.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

const NEW_APPROVAL_MS = 365 * 24 * 60 * 60 * 1000;

export function ApprovalTile({
  item,
  projectId,
  hideSave = false,
}: {
  item: ExploreItem;
  projectId?: string;
  /** Leave out the bookmark (wiki pages have nothing to save into). */
  hideSave?: boolean;
}) {
  const t = TYPE_STYLES[typeKeyForKind("approval")];
  const raw = (item.raw ?? {}) as ApprovalRaw;
  const approved = parseYmd(raw.approval_date) ?? (item.date_iso ? new Date(item.date_iso) : null);
  const validDate = approved && !isNaN(approved.getTime()) ? approved : null;
  const approvedText = validDate
    ? validDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : null;
  const isNew = !!validDate && Date.now() - validDate.getTime() <= NEW_APPROVAL_MS;
  const priority = raw.review_priority?.toUpperCase() === "PRIORITY";
  const brand = raw.brand?.trim() || item.title;
  const generic = raw.generic?.trim();
  const sponsor = raw.sponsor?.trim();
  const chip = "px-2 py-0.5 rounded-full bg-white/55 text-[11px] whitespace-nowrap";
  return (
    <TileShell item={item}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-label" style={{ color: t.fg }}>
          {kindLabel("approval")}
        </span>
        {!hideSave && <SaveButton item={item} projectId={projectId} />}
      </div>
      <h3 className="mt-3 font-title text-[24px] leading-tight font-medium text-on-background line-clamp-2">
        {brand}
      </h3>
      {generic && <p className="mt-0.5 text-[14px] leading-snug text-on-background/70">{generic}</p>}
      {sponsor && <p className="mt-2 text-[13px] leading-snug text-on-background/70">{sponsor}</p>}
      {approvedText && <p className="mt-1 text-xs text-on-background/60">Approved {approvedText}</p>}
      {(priority || isNew) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {isNew && (
            <span className={chip} style={{ color: t.fg }}>
              New
            </span>
          )}
          {priority && (
            <span className={chip} style={{ color: t.fg }}>
              Priority review
            </span>
          )}
        </div>
      )}
    </TileShell>
  );
}

export function TrialTile({
  item,
  projectId,
  hideSave = false,
}: {
  item: ExploreItem;
  projectId?: string;
  /** Leave out the bookmark (wiki pages have nothing to save into). */
  hideSave?: boolean;
}) {
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
        {!hideSave && <SaveButton item={item} projectId={projectId} />}
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
