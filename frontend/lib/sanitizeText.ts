// Strip HTML/XML markup and decode HTML entities to clean PLAIN TEXT.
//
// Source APIs (OpenAlex, PubMed, Crossref) embed markup in titles — e.g.
// "<scp>SDG</scp>", "<i>in vitro</i>", "<sub>2</sub>" — and entities like
// "&amp;". We render titles as plain text (never dangerouslySetInnerHTML), so
// this removes the tags and decodes entities before display / persistence.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

// Match real tags only — "<" (optional "/") followed by a letter, then up to the
// next ">". This strips <scp>, </i>, <sub>, <mml:math> … but preserves literal
// comparisons like "p < 0.05" (a "<" followed by a space/digit is left alone).
const TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;

export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // 1. Remove any raw tags (e.g. <scp>, </i>, <sub>).
  s = s.replace(TAG_RE, "");
  // 2. Decode numeric entities — hex (&#x1F;) then decimal (&#39;).
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)));
  s = s.replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)));
  // 3. Decode common named entities (&amp; → &).
  s = s.replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  // 4. Second strip pass: decoding may have revealed entity-encoded tags
  //    (e.g. &lt;i&gt; → <i>). Remove those too.
  s = s.replace(TAG_RE, "");
  // 5. Collapse whitespace left behind by stripped tags.
  return s.replace(/\s+/g, " ").trim();
}
