"use client";

// "Live Literature" — the podcast-anchoring feature. Takes the episode's own
// concepts/title as a query and pulls CURRENT papers from the live
// PubMed/OpenAlex/Crossref fan-out, so an episode recorded once stays a live
// entry point into the literature around its topic.
//
// Loads independently of the page (its own fetch + skeleton) so a slow external
// search never delays the episode content.

import { useEffect, useState } from "react";
import type { ExploreItem } from "@/types/explore";

function sourceLabel(item: ExploreItem): string {
  if (item.source === "pubmed") return "PubMed";
  if (item.source === "openalex") return "OpenAlex";
  if (item.source === "crossref") return "Crossref";
  return item.source;
}

// "View on PubMed" when we know the host, else DOI, else a neutral label.
function linkLabel(item: ExploreItem): string {
  if (item.source === "pubmed") return "View on PubMed";
  if (item.doi) return "View DOI";
  return "View paper";
}

export default function LiveLiteratureRail({ query }: { query: string }) {
  const [items, setItems] = useState<ExploreItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setItems([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/papers?q=${encodeURIComponent(query)}&limit=8`);
        const json = (await res.json()) as { items?: ExploreItem[]; error?: boolean };
        if (cancelled) return;
        if (json.error) setFailed(true);
        else setItems(json.items ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="glass-panel rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-primary">biotech</span>
        <h2 className="font-headline-md text-headline-md text-on-background">Live Literature</h2>
      </div>
      <p className="font-body-sm text-body-sm text-secondary mb-5">
        Current papers related to this episode&apos;s topics.
      </p>

      {items === null && !failed && (
        <ul className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="animate-pulse">
              <div className="h-4 w-full rounded bg-surface-container" />
              <div className="h-4 w-2/3 rounded bg-surface-container mt-2" />
              <div className="h-3 w-20 rounded bg-surface-container mt-2" />
            </li>
          ))}
        </ul>
      )}

      {failed && (
        <p className="font-body-sm text-body-sm text-secondary">
          Couldn&apos;t reach the literature search right now.
        </p>
      )}

      {items && items.length === 0 && !failed && (
        <p className="font-body-sm text-body-sm text-secondary">
          No related papers found for this episode&apos;s topics.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-5">
          {items.map((item) => (
            <li key={item.id} className="border-b border-outline-variant/30 last:border-0 pb-5 last:pb-0">
              <p className="font-body-md text-body-md text-on-background leading-snug line-clamp-3">
                {item.title}
              </p>
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <span className="px-2 py-0.5 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm">
                  {sourceLabel(item)}
                </span>
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4"
                  >
                    {linkLabel(item)} →
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
