// lib/server/sources/grantsGov.ts — Grants.gov search2 fetcher.
// Moved VERBATIM from app/api/discover/route.ts (Step 4a).
import type { RawDiscoverItem } from "@/types/discover";
import { FETCH_TIMEOUT_MS, toISO, fmtDate } from "@/lib/server/sources/shared";

export async function fetchGrantsGov(term: string, cap: number): Promise<RawDiscoverItem[]> {
  const res = await fetch("https://api.grants.gov/v1/api/search2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword: term, oppStatuses: "forecasted|posted", rows: cap }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Grants.gov ${res.status}`);
  const data = (await res.json()) as {
    data?: {
      oppHits?: {
        id?: string | number;
        title?: string;
        number?: string;
        agencyCode?: string;
        agency?: string;
        openDate?: string;
        postedDate?: string;
      }[];
    };
  };

  return (data.data?.oppHits ?? [])
    .filter((h) => h.title && h.number)
    .map((h) => {
      const isoDate = toISO(h.openDate ?? h.postedDate ?? "");
      return {
        id: `grantsgov-${h.id ?? h.number}`,
        type: "grant" as const,
        title: h.title!,
        description: `${h.agencyCode ?? "?"} — ${h.agency ?? ""}`.trim(),
        source: "Grants.gov",
        date: fmtDate(isoDate),
        dateISO: isoDate,
        url: h.id ? `https://www.grants.gov/search-results-detail/${h.id}` : "https://www.grants.gov/",
        tags: ["Grant", "Grants.gov"],
      };
    });
}
