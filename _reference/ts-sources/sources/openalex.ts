// lib/server/sources/openalex.ts — OpenAlex works fetcher.
// Moved VERBATIM from app/api/discover/route.ts (Step 4a).
import type { RawDiscoverItem } from "@/types/discover";
import { FETCH_TIMEOUT_MS, toISO, fmtDate } from "@/lib/server/sources/shared";

export async function fetchOpenAlex(term: string, cap: number): Promise<RawDiscoverItem[]> {
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(term)}` +
    `&per-page=${cap}&sort=publication_date:desc`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  const data = (await res.json()) as {
    results?: {
      title?: string;
      doi?: string;
      id?: string;
      publication_date?: string;
      primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
      authorships?: { author?: { display_name?: string } }[];
    }[];
  };

  return (data.results ?? [])
    .filter((w) => w.title)
    .map((w) => {
      const isoDate = toISO(w.publication_date ?? "");
      const venue = w.primary_location?.source?.display_name;
      const authors = (w.authorships ?? [])
        .slice(0, 2)
        .map((a) => a.author?.display_name)
        .filter(Boolean)
        .join(", ");
      const desc = [
        venue ? `Published in ${venue}.` : "Indexed in OpenAlex.",
        authors ? `${authors}${(w.authorships?.length ?? 0) > 2 ? " et al." : ""}` : "",
      ].filter(Boolean).join(" ");

      return {
        id: `openalex-${(w.id ?? Math.random().toString()).split("/").pop()}`,
        type: "paper" as const,
        title: w.title!,
        description: desc,
        source: "OpenAlex",
        date: fmtDate(isoDate),
        dateISO: isoDate,
        url: w.doi ?? w.primary_location?.landing_page_url ?? w.id ?? "https://openalex.org",
        tags: ["Paper", "OpenAlex"],
      };
    });
}
