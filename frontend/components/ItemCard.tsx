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
  episode: "border-t-primary-container",
  resource: "border-t-teal-500",
  person: "border-t-secondary",
};

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

  const badge = signalBadge(item);
  const date = badge ? null : formatDate(item.date_iso);
  const accent = ACCENT[item.kind] ?? "border-t-outline-variant";
  const imageUrl =
    item.kind === "episode" ? (item.raw?.image_url as string | undefined) : undefined;

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
          <h3 className="font-headline-md text-lg leading-tight mb-2 text-on-background line-clamp-3">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-secondary text-body-sm font-body-sm line-clamp-2">{item.summary}</p>
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
