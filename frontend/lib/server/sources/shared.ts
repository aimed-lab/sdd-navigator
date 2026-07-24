// lib/server/sources/shared.ts — helpers shared by the source fetchers.
//
// Moved VERBATIM from app/api/discover/route.ts (Step 4a): the fetch timeout and
// the two date helpers every source fetcher uses. Bodies copied unchanged.

export const FETCH_TIMEOUT_MS = 8000;

// ── Date helpers ────────────────────────────────────────────────────────────────

export function toISO(dateStr: string): string {
  if (!dateStr) return new Date(0).toISOString();
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toISOString();
  // PubMed-style "2024 Oct" or "2024 Oct 15"
  const m = /(\d{4})\s+([A-Za-z]{3})(?:\s+(\d{1,2}))?/.exec(dateStr);
  if (m) {
    const parsed = new Date(`${m[2]} ${m[3] ?? "1"} ${m[1]}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

export function fmtDate(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return "Recent";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
