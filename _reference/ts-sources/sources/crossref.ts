// lib/server/sources/crossref.ts — Crossref works fetcher.
// Moved VERBATIM from app/api/discover/route.ts (Step 4a). CROSSREF_NON_ARTICLE_TYPES
// moves with it — it's used only by this fetcher's front-matter guard.
import type { RawDiscoverItem } from "@/types/discover";
import { FETCH_TIMEOUT_MS, toISO, fmtDate } from "@/lib/server/sources/shared";

// Crossref `type` values that aren't research articles (book front-matter,
// chapters, indices, etc.). Preferred signal — checked at fetch time where the
// raw API field is available; the title-pattern check (passesQualityFilter) is
// the fallback.
const CROSSREF_NON_ARTICLE_TYPES = new Set([
  "book", "book-chapter", "book-part", "book-section", "book-component",
  "book-set", "book-series", "edited-book", "monograph", "reference-book",
  "reference-entry", "other-front-matter", "back-matter", "front-matter",
]);

export async function fetchCrossref(term: string, cap: number): Promise<RawDiscoverItem[]> {
  const url =
    `https://api.crossref.org/works?query=${encodeURIComponent(term)}` +
    `&rows=${cap}&sort=published&order=desc`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Crossref ${res.status}`);
  const data = (await res.json()) as {
    message?: {
      items?: {
        title?: string[];
        type?: string;
        DOI?: string;
        URL?: string;
        "container-title"?: string[];
        issued?: { "date-parts"?: number[][] };
      }[];
    };
  };

  return (data.message?.items ?? [])
    .filter((w) => (w.title ?? [])[0])
    // Primary front-matter guard: drop non-article Crossref types (books,
    // chapters, indices). The title-pattern fallback lives in passesQualityFilter.
    .filter((w) => !CROSSREF_NON_ARTICLE_TYPES.has((w.type ?? "").toLowerCase()))
    .map((w) => {
      const parts = w.issued?.["date-parts"]?.[0] ?? [];
      const isoDate = parts.length
        ? toISO(`${parts[0]}-${String(parts[1] ?? 1).padStart(2, "0")}-${String(parts[2] ?? 1).padStart(2, "0")}`)
        : toISO("");
      const venue = (w["container-title"] ?? [])[0];
      return {
        id: `crossref-${(w.DOI ?? Math.random().toString()).replace(/\//g, "-")}`,
        type: "paper" as const,
        title: w.title![0],
        description: venue ? `Published in ${venue}.` : "Indexed in Crossref.",
        source: "Crossref",
        date: fmtDate(isoDate),
        dateISO: isoDate,
        url: w.URL ?? (w.DOI ? `https://doi.org/${w.DOI}` : "https://search.crossref.org"),
        tags: ["Paper", "Crossref"],
      };
    });
}
