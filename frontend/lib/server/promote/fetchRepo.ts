// lib/server/promote/fetchRepo.ts — single-repo metadata + README fetch for
// "Promote"'s tool-post generation path, the GitHub counterpart to
// fetchPaper.ts's DOI/PMID path.
//
// REUSE, NOT A SECOND CLIENT: GitHub is already an Explore source
// (backend/explore-mcp/sources/github.py), and that Python module already
// owns GitHub's auth (GITHUB_TOKEN) and rate-limit handling. This does NOT
// call api.github.com directly — it calls the explore-mcp backend's new
// /api/github-repo bridge (backend/explore-mcp/server.py), the exact same
// way app/api/papers/route.ts already calls that backend's /api/papers:
// same EXPLORE_API_URL, same exploreBackendHeaders(). The one thing that
// bridge does that the existing GitHub Explore source never did — fetch a
// SINGLE repo's full metadata and its README body — lives in
// sources/github.py's new fetch_github_repo_detail(), not duplicated here.

import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

export type RepoMetadata = {
  fullName: string; // "owner/repo"
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number | null;
  pushedDate: string | null;
  url: string;
  /** The README body, decoded, capped at ~8000 chars server-side (see
   *  sources/github.py's own _MAX_README_CHARS comment) — null when the
   *  repo has no README, or the fetch failed. generateToolArticle.ts is
   *  told explicitly to write more conservatively when this is null,
   *  rather than fabricating usage it can't see. */
  readme: string | null;
};

// A GitHub repo URL — with or without a protocol/www, an optional
// trailing ".git", and an optional "/tree/branch" or query/hash suffix a
// browser address bar often carries. A bare "owner/repo" shorthand is
// deliberately NOT matched: the task is "paste a repository URL", and a
// bare slash-separated string is genuinely ambiguous against a DOI's own
// shape (see the generate route's own ordering comment).
const GITHUB_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i;

export function parseGithubRepoUrl(raw: string): { owner: string; repo: string } | null {
  const m = GITHUB_URL_RE.exec(raw.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Fetch one repo's metadata + README via the explore-mcp backend. Returns
 *  null on any failure (not a GitHub URL, repo doesn't exist, backend
 *  unreachable) — same "best-effort, caller treats null as not-found"
 *  contract fetchPaperById's own source helpers use. */
export async function fetchRepoByUrl(raw: string): Promise<RepoMetadata | null> {
  const parsed = parseGithubRepoUrl(raw);
  if (!parsed) return null;

  try {
    const res = await fetch(
      `${EXPLORE_API_URL}/api/github-repo?repo=${encodeURIComponent(`${parsed.owner}/${parsed.repo}`)}`,
      { cache: "no-store", headers: exploreBackendHeaders() }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      full_name?: string;
      description?: string | null;
      language?: string | null;
      topics?: string[];
      stars?: number | null;
      pushed_at?: string | null;
      html_url?: string;
      readme?: string | null;
      error?: string;
    };
    if (data.error || !data.full_name) return null;

    return {
      fullName: data.full_name,
      description: data.description ?? null,
      language: data.language ?? null,
      topics: Array.isArray(data.topics) ? data.topics : [],
      stars: typeof data.stars === "number" ? data.stars : null,
      pushedDate: data.pushed_at ?? null,
      url: data.html_url ?? `https://github.com/${parsed.owner}/${parsed.repo}`,
      readme: data.readme ?? null,
    };
  } catch {
    return null;
  }
}
