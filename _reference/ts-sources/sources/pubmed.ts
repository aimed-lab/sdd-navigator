// lib/server/sources/pubmed.ts — PubMed E-utilities fetcher.
// Moved VERBATIM from app/api/discover/route.ts (Step 4a).
import type { RawDiscoverItem } from "@/types/discover";
import { FETCH_TIMEOUT_MS, toISO, fmtDate } from "@/lib/server/sources/shared";

export async function fetchPubMed(term: string, cap: number): Promise<RawDiscoverItem[]> {
  const searchUrl =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
    `?db=pubmed&term=${encodeURIComponent(term)}&retmax=${cap}&sort=date&retmode=json`;
  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!searchRes.ok) throw new Error(`PubMed esearch ${searchRes.status}`);
  const searchData = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = searchData.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  const summaryUrl =
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` +
    `?db=pubmed&id=${ids.join(",")}&retmode=json`;
  const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!summaryRes.ok) throw new Error(`PubMed esummary ${summaryRes.status}`);
  const summaryData = (await summaryRes.json()) as {
    result?: Record<string, { title?: string; source?: string; pubdate?: string; authors?: { name: string }[] }>;
  };
  const result = summaryData.result ?? {};

  return ids
    .filter((id) => (result[id]?.title ?? "").trim().length > 0)
    .map((id) => {
      const item = result[id];
      const isoDate = toISO(item.pubdate ?? "");
      const authorStr =
        (item.authors ?? []).slice(0, 2).map((a) => a.name).join(", ") +
        ((item.authors?.length ?? 0) > 2 ? " et al." : "");

      return {
        id: `pubmed-${id}`,
        type: "paper" as const,
        title: item.title!,
        description: `Published in ${item.source ?? "Unknown Journal"}. ${authorStr}`.trim(),
        source: item.source ?? "PubMed",
        date: fmtDate(isoDate),
        dateISO: isoDate,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        tags: ["Paper", "PubMed"],
      };
    });
}
