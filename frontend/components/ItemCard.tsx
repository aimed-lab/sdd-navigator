"use client";

// ItemCard — the reusable result card for the whole platform (Explore, search,
// saved, etc.). Renders one backend Item: title, one-line context, and an
// evidence-backed SIGNAL BADGE only when a real metric exists. It NEVER shows a
// vague label ("recommended" etc.) — no signal falls back to the date, or nothing.

import { useState } from "react";
import type { ExploreItem } from "@/types/explore";

// Per-kind top-border accent (literal class strings so Tailwind compiles them).
const ACCENT: Record<string, string> = {
  paper: "border-t-primary",
  news: "border-t-sky-500",
  tool: "border-t-blue-500",
  trial: "border-t-purple-500",
  grant: "border-t-amber-500",
  dataset: "border-t-emerald-500",
  episode: "border-t-primary-container",
  resource: "border-t-teal-500",
  person: "border-t-secondary",
};

// GEO dataset fields (backend/explore-mcp/sources/geo.py) — all in `raw`,
// there is no top-level Item field for any of them except date_iso/url.
type GeoRaw = {
  accession?: string;
  organism?: string | null;
  sample_count?: number | null;
  experiment_type?: string | null;
  platform?: string | null;
};

function geoFields(item: ExploreItem): GeoRaw | null {
  if (item.kind !== "dataset") return null;
  return (item.raw ?? {}) as GeoRaw;
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n)}`;
}

function citationText(value: number): string | null {
  const n = Math.round(value);
  return n > 0 ? `${n.toLocaleString()} citation${n === 1 ? "" : "s"}` : null;
}

// The citation count the backend preserved when it replaced the signal with a
// network_rank one (ranking.py stashes the displaced metric in raw.prior_signal).
function priorCitations(item: ExploreItem): string | null {
  const prior = item.raw?.prior_signal as { metric?: string; value?: number } | undefined;
  if (!prior || prior.metric !== "citations" || typeof prior.value !== "number") return null;
  return citationText(prior.value);
}

// A real, evidence-backed badge string, or null if the signal isn't meaningful.
// citations only when > 0 (a page of 0-citation preprints shouldn't all read
// "0 citations" — fall back to the date instead); stars always (GitHub filters >=5).
function signalBadge(item: ExploreItem): string | null {
  const signal = item.signal;
  if (!signal) return null;

  // WINNER network centrality. The raw score is an internal graph quantity with
  // no meaning to a reader ("3.00" says nothing), so it is NEVER shown — the
  // label is qualitative and is backed by the real, preserved citation count.
  if (signal.metric === "network_rank") {
    const cites = priorCitations(item);
    return cites ? `★ Key paper · ${cites}` : "★ Key paper";
  }

  if (signal.metric === "citations") return citationText(signal.value);
  if (signal.metric === "stars") return `★ ${compact(signal.value)} stars`;
  return signal.value > 0 ? `${compact(signal.value)} ${signal.metric}` : null;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null; // epoch/placeholder -> nothing
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ItemCard({ item }: { item: ExploreItem }) {
  const [saved, setSaved] = useState(false);

  // GEO reports no ranking metric (see backend/explore-mcp/tools/search_datasets.py
  // — it never calls WINNER, there is no citation graph between datasets), so
  // signal is always null here and signalBadge() falls through to the plain date
  // badge below automatically. No dataset-specific badge logic needed or wanted:
  // a badge slot is exactly where a fabricated "ranked" label would be a lie.
  const badge = signalBadge(item);
  const date = badge ? null : formatDate(item.date_iso);
  const accent = ACCENT[item.kind] ?? "border-t-outline-variant";
  const imageUrl =
    item.kind === "episode" ? (item.raw?.image_url as string | undefined) : undefined;
  const geo = geoFields(item);

  const open = () => {
    if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={`glass-card group flex flex-col overflow-hidden rounded-xl border-t-4 ${accent} min-h-[220px] cursor-pointer`}
    >
      {imageUrl && (
        <div className="w-full aspect-video bg-surface-container-high overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
      )}

      <div className="flex flex-col flex-1 p-6">
        <div className="flex items-start gap-2 mb-4">
          {/* Signal badge only when a real metric exists; else the date; else
              NOTHING (never a vague label or a raw source slug). */}
          {badge ? (
            <span className="inline-block px-3 py-1 rounded-full bg-primary text-on-primary text-label-sm font-label-sm">
              {badge}
            </span>
          ) : date ? (
            <span className="inline-block px-3 py-1 rounded-full bg-surface-container-low text-secondary text-label-sm font-label-sm">
              {date}
            </span>
          ) : null}

          <button
            onClick={(e) => {
              e.stopPropagation();
              setSaved((s) => !s);
            }}
            aria-label={saved ? "Remove bookmark" : "Save item"}
            className="text-secondary hover:text-primary transition-colors shrink-0 ml-auto"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0" }}
            >
              bookmark
            </span>
          </button>
        </div>

        <div className="mt-auto">
          {/* Organism + sample count are what tells a researcher in one glance
              whether this dataset is worth opening — PROMINENT (bold, badge-sized
              text), not folded into the small-print summary line below. This is
              deliberately doing the job a relevance filter would otherwise do
              badly (see backend audit: GEO keyword search returns real but
              sometimes only-incidentally-relevant hits). */}
          {geo && (geo.organism || geo.sample_count != null) && (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {geo.organism && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 font-label-md text-label-md font-semibold">
                  {geo.organism}
                </span>
              )}
              {geo.sample_count != null && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 font-label-md text-label-md font-semibold">
                  {geo.sample_count.toLocaleString()} sample{geo.sample_count === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}

          <h3 className="font-headline-md text-lg leading-tight mb-2 text-on-background line-clamp-3">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-secondary text-body-sm font-body-sm line-clamp-2">{item.summary}</p>
          )}

          {/* Accession (explicit link, not just relying on the whole-card click),
              experiment type and platform — secondary metadata, smaller print is
              fine here since organism/sample-count above already carries the
              at-a-glance decision. */}
          {geo && (geo.accession || geo.experiment_type || geo.platform) && (
            <div className="mt-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-secondary text-body-sm font-body-sm">
              {geo.accession && item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary hover:underline font-medium"
                >
                  {geo.accession}
                </a>
              )}
              {geo.experiment_type && <span>{geo.experiment_type}</span>}
              {geo.platform && <span>{geo.platform}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Loading placeholder matching the card footprint.
export function SkeletonCard() {
  return (
    <div className="glass-card rounded-xl border-t-4 border-t-surface-variant min-h-[220px] p-6 animate-pulse">
      <div className="flex justify-between items-start mb-6">
        <div className="h-6 w-24 rounded-full bg-surface-container" />
        <div className="h-6 w-6 rounded bg-surface-container" />
      </div>
      <div className="mt-auto space-y-2">
        <div className="h-4 w-full rounded bg-surface-container" />
        <div className="h-4 w-2/3 rounded bg-surface-container" />
      </div>
    </div>
  );
}
