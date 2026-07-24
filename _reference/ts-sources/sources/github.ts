// lib/server/sources/github.ts — GitHub repository search fetcher.
// Moved VERBATIM from app/api/discover/route.ts (Step 4a).
import type { RawDiscoverItem } from "@/types/discover";
import { FETCH_TIMEOUT_MS, toISO, fmtDate } from "@/lib/server/sources/shared";

export async function fetchGitHubTools(term: string, cap: number): Promise<RawDiscoverItem[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const q = `${term} stars:>=5`;
  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
    `&sort=stars&order=desc&per_page=${cap}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GitHub search ${res.status}`);
  const data = (await res.json()) as {
    items?: {
      full_name?: string;
      description?: string;
      html_url?: string;
      pushed_at?: string;
      stargazers_count?: number;
      language?: string | null;
      topics?: string[];
    }[];
  };

  return (data.items ?? [])
    .filter((r) => r.full_name)
    .map((r) => {
      const isoDate = toISO(r.pushed_at ?? "");
      const tags = ["Tool", ...(r.language ? [r.language] : []), ...(r.topics ?? []).slice(0, 2)];
      return {
        id: `github-${r.full_name}`,
        type: "tool" as const,
        title: r.full_name!,
        description: r.description || "Open-source tool on GitHub.",
        source: `GitHub${r.stargazers_count ? ` · ${r.stargazers_count}★` : ""}`,
        date: fmtDate(isoDate),
        dateISO: isoDate,
        url: r.html_url ?? `https://github.com/${r.full_name}`,
        tags,
      };
    });
}
