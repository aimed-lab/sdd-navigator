// Client-side citation export for a project's Resources section — BibTeX
// (.bib) and RIS (.ris). Runs entirely in the browser: every item is
// already on the page via ProjectResources.items, so there's no API route.
//
// DATA LIMITS (see ResourcesSection.tsx / lib/server/projectResources.ts):
// ExploreItem never carries an author list, for any item, of any kind — so
// no entry here ever gets an author/AU field. Faking one would be worse
// than omitting it; both BibTeX and RIS are valid without it.
//
// Only kind === "paper" ever has a populated `doi`, and even then it's
// optional. Every other kind (dataset, trial, tool, grant, news, resource,
// person, episode, geneset, compound, target — the last three don't get a
// count tile yet but are still valid ExploreItem.kind values) is exported
// as a generic entry (BibTeX @misc / RIS TY - GEN) carrying title/url/
// source/date, so nothing silently disappears from the export just because
// there's no natural bibliographic type for a clinical trial or a gene set.

import type { ExploreItem } from "@/types/explore";

function yearOf(item: ExploreItem): string | undefined {
  const y = item.date_iso ? item.date_iso.slice(0, 4) : undefined;
  return y && /^\d{4}$/.test(y) ? y : undefined;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** BibTeX cite keys must be unique within the file and collision-free
 *  across items with similar titles/years — append an index to guarantee
 *  that rather than hoping title+year is enough. */
function citeKey(item: ExploreItem, index: number): string {
  const base = slug(item.title || item.kind || "item") || "item";
  const year = yearOf(item);
  return `${base}${year ? `-${year}` : ""}-${index + 1}`;
}

function escapeBibtex(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\\/g, "");
}

function bibtexField(name: string, value: string | null | undefined): string {
  if (!value) return "";
  return `  ${name} = {${escapeBibtex(value)}},\n`;
}

export function itemsToBibtex(items: ExploreItem[]): string {
  const entries = items.map((item, index) => {
    const isPaper = item.kind === "paper";
    const type = isPaper ? "article" : "misc";
    const key = citeKey(item, index);
    const year = yearOf(item);

    let body = "";
    body += bibtexField("title", item.title);
    if (isPaper) {
      body += bibtexField("journal", item.source);
    } else {
      // Plain URL, not wrapped in \url{} — bibtexField's escaping strips
      // braces/backslashes from every field value (it can't tell a LaTeX
      // macro from user text to protect), which mangled a wrapped URL into
      // "urlhttps://...". A bare URL string survives that untouched and
      // still imports fine as the field's plain-text value.
      body += bibtexField("howpublished", item.url ?? undefined);
      body += bibtexField("note", item.source);
    }
    body += bibtexField("year", year);
    body += bibtexField("url", item.url ?? undefined);
    body += bibtexField("doi", item.doi ?? undefined);
    // Trailing comma on the last field is valid BibTeX and keeps this
    // simple — no need to special-case the final line.
    return `@${type}{${key},\n${body}}`;
  });

  return entries.join("\n\n") + "\n";
}

function risField(tag: string, value: string | null | undefined): string {
  if (!value) return "";
  return `${tag}  - ${value}\n`;
}

export function itemsToRis(items: ExploreItem[]): string {
  const entries = items.map((item) => {
    const isPaper = item.kind === "paper";
    const year = yearOf(item);

    let body = `TY  - ${isPaper ? "JOUR" : "GEN"}\n`;
    body += risField("TI", item.title);
    if (isPaper) {
      body += risField("JF", item.source);
    } else {
      body += risField("PB", item.source);
    }
    body += risField("PY", year);
    body += risField("UR", item.url ?? undefined);
    body += risField("DO", item.doi ?? undefined);
    body += "ER  - \n";
    return body;
  });

  return entries.join("\n");
}

function download(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportItems(
  items: ExploreItem[],
  format: "bibtex" | "ris",
  projectName: string
): void {
  const base = slug(projectName) || "project";
  if (format === "bibtex") {
    download(`${base}-resources.bib`, itemsToBibtex(items));
  } else {
    download(`${base}-resources.ris`, itemsToRis(items));
  }
}
