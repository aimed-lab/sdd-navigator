// lib/server/sources/clinicalTrials.ts — ClinicalTrials.gov v2 fetcher.
// Moved VERBATIM from app/api/discover/route.ts (Step 4a).
import type { RawDiscoverItem } from "@/types/discover";
import { FETCH_TIMEOUT_MS, toISO, fmtDate } from "@/lib/server/sources/shared";

export async function fetchClinicalTrials(term: string, cap: number): Promise<RawDiscoverItem[]> {
  const url =
    "https://clinicaltrials.gov/api/v2/studies" +
    `?query.term=${encodeURIComponent(term)}&pageSize=${cap}&sort=LastUpdatePostDate:desc`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
  const data = (await res.json()) as {
    studies?: {
      protocolSection?: {
        identificationModule?: { nctId?: string; briefTitle?: string };
        statusModule?: { startDateStruct?: { date?: string }; overallStatus?: string };
        descriptionModule?: { briefSummary?: string };
      };
    }[];
  };

  return (data.studies ?? [])
    .map((s) => {
      const proto = s.protocolSection ?? {};
      const ident = proto.identificationModule ?? {};
      const status = proto.statusModule ?? {};
      const desc = proto.descriptionModule ?? {};
      const nctId = ident.nctId ?? "";
      const isoDate = toISO(status.startDateStruct?.date ?? "");
      return {
        id: `ct-${nctId}`,
        type: "trial" as const,
        title: ident.briefTitle ?? "Clinical Trial",
        description:
          (desc.briefSummary ?? "").slice(0, 220) ||
          `${status.overallStatus ?? "Active"} clinical trial.`,
        source: "ClinicalTrials.gov",
        date: fmtDate(isoDate),
        dateISO: isoDate,
        url: `https://clinicaltrials.gov/study/${nctId}`,
        tags: ["Trial", status.overallStatus ?? "Clinical Trial"],
      };
    })
    .filter((i) => i.id !== "ct-");
}
