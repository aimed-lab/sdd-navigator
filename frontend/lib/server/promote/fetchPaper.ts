// lib/server/promote/fetchPaper.ts — single-paper metadata fetch for "Promote".
//
// Unlike the Discovery source fetchers (lib/server/sources/*.ts), which take a
// SEARCH TERM and return a list, this resolves ONE paper by its identifier — a
// DOI (e.g. "10.64898/2026.07.09.737590") or a numeric PubMed ID — and pulls
// title / authors / abstract from whichever source has them.
//
// Resolution order (see fetchPaperById):
//   DOI  → bioRxiv (preprints; full record incl. abstract) → Crossref (metadata,
//          abstract often absent) → PubMed E-utilities for the abstract only.
//   PMID → PubMed esummary (metadata) + efetch (abstract).
//
// Reuses the same 8s AbortSignal.timeout budget as the source fetchers
// (FETCH_TIMEOUT_MS) and cleanText for stripping JATS/HTML markup out of titles
// and abstracts. Each source helper is best-effort: it returns null instead of
// throwing (there is no Promise.allSettled wrapper here as in discovery.ts), so
// one dead source never sinks the whole lookup.

import { FETCH_TIMEOUT_MS } from "@/lib/server/sources/shared";
import { cleanText } from "@/lib/sanitizeText";

export type PaperMetadata = {
  title: string;
  authors: string[];
  abstract: string | null;
  abstractSource: "biorxiv" | "crossref" | "pubmed" | null; // where the abstract came from
  doi: string | null;
  pmid: string | null;
  publishedDate: string | null;
  sourceUrl: string; // link to the paper itself (doi.org/{doi} or the PubMed page)
};

// ── Identifier detection / normalization ──────────────────────────────────────

// Reduce user input to a bare identifier: strip a "doi:" prefix or a doi.org URL
// wrapper so both "10.1101/x", "doi:10.1101/x" and "https://doi.org/10.1101/x"
// resolve identically.
function normalizeInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim();
}

const isPmid = (s: string) => /^\d+$/.test(s); // PMIDs are numeric-only
const isDoi = (s: string) => !isPmid(s) && s.includes("/"); // DOIs contain a "/"

// bioRxiv authors arrive as one "Last, F. M.; Last2, F." string; Crossref as
// structured given/family. Normalize both to a clean string[].
function splitBiorxivAuthors(authors: string | undefined): string[] {
  if (!authors) return [];
  return authors
    .split(";")
    .map((a) => cleanText(a))
    .filter(Boolean);
}

// Crossref/PubMed date-parts [YYYY, M, D] → "YYYY-MM-DD" (month/day optional).
function partsToDate(parts: number[] | undefined): string | null {
  if (!parts || !parts.length) return null;
  const [y, m, d] = parts;
  return [y, m, d]
    .filter((n) => typeof n === "number")
    .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0")))
    .join("-");
}

// ── Source helpers (each best-effort → null on any miss/failure) ───────────────

type PartialMeta = {
  title: string;
  authors: string[];
  abstract: string | null;
  publishedDate: string | null;
  doi: string | null;
};

// bioRxiv details endpoint — returns the full preprint record (incl. abstract)
// when the DOI is a bioRxiv preprint; an empty `collection` means no match.
async function fetchFromBiorxiv(doi: string): Promise<PartialMeta | null> {
  try {
    const res = await fetch(`https://api.biorxiv.org/details/biorxiv/${doi}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      collection?: { title?: string; authors?: string; abstract?: string; date?: string; doi?: string }[];
    };
    const rec = data.collection?.[0];
    if (!rec || !(rec.title ?? "").trim()) return null; // no usable match
    return {
      title: cleanText(rec.title),
      authors: splitBiorxivAuthors(rec.authors),
      abstract: (rec.abstract ?? "").trim() ? cleanText(rec.abstract) : null,
      publishedDate: rec.date ?? null,
      doi: rec.doi ?? doi,
    };
  } catch {
    return null;
  }
}

// Crossref works/{doi} — reliable title/authors/date. `abstract` is frequently
// absent (hasAbstract:false); a missing abstract is NOT a failure here.
async function fetchFromCrossref(doi: string): Promise<PartialMeta | null> {
  try {
    const res = await fetch(`https://api.crossref.org/works/${doi}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      message?: {
        title?: string[];
        author?: { given?: string; family?: string }[];
        abstract?: string;
        DOI?: string;
        published?: { "date-parts"?: number[][] };
        "published-online"?: { "date-parts"?: number[][] };
        issued?: { "date-parts"?: number[][] };
      };
    };
    const m = data.message;
    const title = (m?.title ?? [])[0];
    if (!m || !(title ?? "").trim()) return null;
    const authors = (m.author ?? [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" ").trim())
      .filter(Boolean);
    const dateParts = (m.published ?? m["published-online"] ?? m.issued)?.["date-parts"]?.[0];
    return {
      title: cleanText(title),
      authors,
      abstract: (m.abstract ?? "").trim() ? cleanText(m.abstract) : null,
      publishedDate: partsToDate(dateParts),
      doi: m.DOI ?? doi,
    };
  } catch {
    return null;
  }
}

// PubMed esearch by DOI → first matching PMID (null when the DOI isn't in PubMed,
// e.g. a preprint).
async function pubmedFindPmidByDoi(doi: string): Promise<string | null> {
  try {
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
      `?db=pubmed&term=${encodeURIComponent(`${doi}[doi]`)}&retmode=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as { esearchresult?: { idlist?: string[] } };
    return data.esearchresult?.idlist?.[0] ?? null;
  } catch {
    return null;
  }
}

// PubMed esummary → title/authors/date/doi for a PMID (mirrors sources/pubmed.ts).
async function pubmedEsummary(pmid: string): Promise<PartialMeta | null> {
  try {
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi" +
      `?db=pubmed&id=${pmid}&retmode=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: Record<
        string,
        {
          title?: string;
          pubdate?: string;
          authors?: { name: string }[];
          articleids?: { idtype?: string; value?: string }[];
        }
      >;
    };
    const doc = data.result?.[pmid];
    if (!doc || !(doc.title ?? "").trim()) return null;
    const doi = doc.articleids?.find((a) => a.idtype === "doi")?.value ?? null;
    return {
      title: cleanText(doc.title),
      authors: (doc.authors ?? []).map((a) => a.name).filter(Boolean),
      abstract: null, // esummary has no abstract; efetch supplies it
      publishedDate: doc.pubdate ?? null,
      doi,
    };
  } catch {
    return null;
  }
}

// PubMed efetch → plain-text abstract for a PMID (rettype=abstract&retmode=text).
async function pubmedAbstract(pmid: string): Promise<string | null> {
  try {
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
      `?db=pubmed&id=${pmid}&rettype=abstract&retmode=text`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = cleanText(await res.text());
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

// Resolve one paper by DOI or PMID. Returns null only when NO source yields
// anything usable (not even a title).
export async function fetchPaperById(input: string): Promise<PaperMetadata | null> {
  const id = normalizeInput(input);
  if (!id) return null;

  // ── PMID given directly: PubMed esummary (metadata) + efetch (abstract) ──────
  if (isPmid(id)) {
    const base = await pubmedEsummary(id);
    if (!base) return null;
    const abstract = await pubmedAbstract(id);
    return {
      title: base.title,
      authors: base.authors,
      abstract,
      abstractSource: abstract ? "pubmed" : null,
      doi: base.doi,
      pmid: id,
      publishedDate: base.publishedDate,
      sourceUrl: base.doi
        ? `https://doi.org/${base.doi}`
        : `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
    };
  }

  if (!isDoi(id)) return null; // neither a PMID nor a DOI — nothing to resolve

  // ── DOI path ─────────────────────────────────────────────────────────────────
  const doi = id;
  let base: PartialMeta | null = null;
  let abstract: string | null = null;
  let abstractSource: PaperMetadata["abstractSource"] = null;

  // 1. bioRxiv first — preprints come back complete (title, authors, abstract).
  base = await fetchFromBiorxiv(doi);
  if (base?.abstract) {
    abstract = base.abstract;
    abstractSource = "biorxiv";
  }

  // 2. Crossref fallback for title/authors/date (abstract often absent).
  if (!base) {
    base = await fetchFromCrossref(doi);
    if (base?.abstract) {
      abstract = base.abstract;
      abstractSource = "crossref";
    }
  }

  // 3. Always backfill the abstract from PubMed if no source has yielded one.
  //    esearch(doi) → PMID, then efetch the abstract text. This also lets us
  //    populate the pmid field when the paper IS indexed in PubMed.
  let pmid: string | null = null;
  if (!abstract) {
    pmid = await pubmedFindPmidByDoi(doi);
    if (pmid) {
      // If bioRxiv AND Crossref both missed, fall back to PubMed for metadata too.
      if (!base) base = await pubmedEsummary(pmid);
      const pubAbstract = await pubmedAbstract(pmid);
      if (pubAbstract) {
        abstract = pubAbstract;
        abstractSource = "pubmed";
      }
    }
  }

  if (!base || !base.title) return null; // nothing usable resolved

  return {
    title: base.title,
    authors: base.authors,
    abstract,
    abstractSource,
    doi: base.doi ?? doi,
    pmid,
    publishedDate: base.publishedDate,
    sourceUrl: `https://doi.org/${base.doi ?? doi}`,
  };
}
