import { NextResponse } from "next/server";

// =============================================================================
// GET /api/orcid?id=<ORCID> — server-side proxy for ORCID public data.
// =============================================================================
// Ported from the prototype's app/api/orcid/works/route.ts. Reads a researcher's
// PUBLIC record from pub.orcid.org in one action:
//   • /person → name, biography, keywords (→ research interests), LinkedIn
//   • /works  → the 5 most recent publications (title, year, url)
//
// No secret needed — pub.orcid.org serves public records with just
// `Accept: application/json`. Fetched server-side (like /api/promote/generate)
// so the browser never deals with ORCID CORS, and normalized down to the few
// fields the profile editor pre-fills.
//
// PUBLIC and READ-ONLY. It persists NOTHING and needs no session: the ORCID
// record is already public, the caller is only pre-filling a form they must
// still review and save themselves through app/profile/actions.ts.
//
// The prototype's `?debug=1` hook (which echoed ORCID's raw payloads) is
// deliberately NOT ported — it was marked temporary there, and proxying an
// upstream response verbatim is not something to leave in a shipped route.
// =============================================================================

export const dynamic = "force-dynamic";

// 0000-0002-1825-0097 — four groups of 4, last char may be X (checksum).
const ORCID_RE = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i;

// A senior researcher can have 100+ works; importing all of them floods the
// profile. Take the 5 most recent — more can be added by hand later.
const MAX_WORKS = 5;

type NormalizedWork = { title: string; year: number | null; url: string | null };

type WorkSummary = {
  title?: { title?: { value?: string | null } | null } | null;
  "publication-date"?: {
    year?: { value?: string | null } | null;
    month?: { value?: string | null } | null;
    day?: { value?: string | null } | null;
  } | null;
  url?: { value?: string | null } | null;
  "external-ids"?: {
    "external-id"?: Array<{
      "external-id-type"?: string | null;
      "external-id-value"?: string | null;
      "external-id-url"?: { value?: string | null } | null;
    }>;
  } | null;
};
type OrcidWorksResponse = { group?: Array<{ "work-summary"?: WorkSummary[] }> };

type OrcidPersonResponse = {
  name?: {
    "given-names"?: { value?: string | null } | null;
    "family-name"?: { value?: string | null } | null;
    "credit-name"?: { value?: string | null } | null;
  } | null;
  biography?: { content?: string | null } | null;
  keywords?: { keyword?: Array<{ content?: string | null }> } | null;
  "researcher-urls"?: {
    "researcher-url"?: Array<{
      "url-name"?: string | null;
      url?: { value?: string | null } | null;
    }>;
  } | null;
};

/** Best-effort URL for a work: explicit url, else the DOI's external-id-url,
 *  else a doi.org link built from the DOI value, else any external-id-url. */
function workUrl(summary: WorkSummary): string | null {
  if (summary.url?.value) return summary.url.value;
  const ids = summary["external-ids"]?.["external-id"] ?? [];
  const doi = ids.find((i) => (i["external-id-type"] ?? "").toLowerCase() === "doi");
  if (doi) {
    if (doi["external-id-url"]?.value) return doi["external-id-url"].value;
    if (doi["external-id-value"]) return `https://doi.org/${doi["external-id-value"]}`;
  }
  return ids.find((i) => i["external-id-url"]?.value)?.["external-id-url"]?.value ?? null;
}

/** Sortable key from publication-date (y*10000 + m*100 + d). Missing parts
 *  default to 0 so year-only dates still order correctly, newest first. */
function dateKey(summary: WorkSummary): number {
  const d = summary["publication-date"];
  const num = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? parseInt(v, 10) : 0);
  return num(d?.year?.value) * 10000 + num(d?.month?.value) * 100 + num(d?.day?.value);
}

function fetchOrcid(orcid: string, path: string): Promise<Response> {
  return fetch(`https://pub.orcid.org/v3.0/${orcid}/${path}`, {
    headers: { Accept: "application/json" },
    // External and read-only — never let a slow ORCID hang the editor.
    signal: AbortSignal.timeout(12000),
  });
}

function parseWorks(data: OrcidWorksResponse | null): NormalizedWork[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: Array<NormalizedWork & { key: number }> = [];

  for (const group of data.group ?? []) {
    // A group is one work, possibly from several sources — keep the first.
    const summary = group["work-summary"]?.[0];
    if (!summary) continue;
    const title = summary.title?.title?.value?.trim();
    if (!title) continue;

    const yearStr = summary["publication-date"]?.year?.value;
    const year = yearStr && /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : null;

    const dedupe = `${title.toLowerCase()}::${year ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    rows.push({ title, year, url: workUrl(summary), key: dateKey(summary) });
  }

  rows.sort((a, b) => b.key - a.key);
  return rows.slice(0, MAX_WORKS).map(({ title, year, url }) => ({ title, year, url }));
}

function parsePerson(data: OrcidPersonResponse | null) {
  if (!data) return { name: null, bio: null, keywords: [] as string[], linkedin: null };

  const credit = data.name?.["credit-name"]?.value?.trim();
  const given = data.name?.["given-names"]?.value?.trim() ?? "";
  const family = data.name?.["family-name"]?.value?.trim() ?? "";
  const composed = [given, family].filter(Boolean).join(" ").trim();

  const keywords = (data.keywords?.keyword ?? [])
    .map((k) => k.content?.trim())
    .filter((k): k is string => Boolean(k));

  const urls = data["researcher-urls"]?.["researcher-url"] ?? [];
  const linkedin =
    urls.find((u) => (u["url-name"] ?? "").toLowerCase().includes("linkedin"))?.url?.value?.trim() ||
    null;

  return {
    name: credit || composed || null,
    bio: data.biography?.content?.trim() || null,
    keywords,
    linkedin,
  };
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("id") ?? "";
  const match = raw.match(ORCID_RE);
  if (!match) {
    return NextResponse.json(
      { error: "Enter a valid ORCID iD, e.g. 0000-0002-1825-0097." },
      { status: 400 }
    );
  }
  const orcid = match[1].toUpperCase();

  let worksRes: Response;
  let personRes: Response;
  try {
    [worksRes, personRes] = await Promise.all([
      fetchOrcid(orcid, "works"),
      fetchOrcid(orcid, "person"),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Could not reach ORCID. Please try again." },
      { status: 502 }
    );
  }

  // /works is the primary signal — a 404 there means "no such record".
  if (worksRes.status === 404) {
    return NextResponse.json(
      { error: "No public ORCID record found for that iD." },
      { status: 404 }
    );
  }
  if (!worksRes.ok) {
    return NextResponse.json(
      { error: "ORCID returned an error. Please try again." },
      { status: 502 }
    );
  }

  const worksData = (await worksRes.json().catch(() => null)) as OrcidWorksResponse | null;
  // Person is best-effort: if it fails we still return the works.
  const personData = personRes.ok
    ? ((await personRes.json().catch(() => null)) as OrcidPersonResponse | null)
    : null;

  return NextResponse.json({
    orcid,
    works: parseWorks(worksData),
    person: parsePerson(personData),
  });
}
