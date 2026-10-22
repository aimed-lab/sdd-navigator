// lib/server/promote/cardLayout.ts \u2014 the sizing rules for the visual card: font
// sizes that shrink as text gets longer (key facts are never cut off), and the
// short pieces of text the card shows. Pure, so `npm test` covers it.

// WHY card text is cleaned. The image renderer (next/og) ships one Latin font.
// For any character that font does not have (a curly quote, an arrow, a Greek
// letter, an emoji) it DOWNLOADS a font or emoji image from fonts.googleapis.com
// or cdn.jsdelivr.net while drawing. With no route to those hosts the request
// hangs until the connection resets (minutes), and the card never renders. So
// every string is reduced to characters the bundled font has: Basic Latin and
// Latin-1. Nothing is fetched while drawing.

const PUNCT: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u2032\u02BC]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u25CF\u25AA]/g, "-"],
  [/\u2192/g, "->"],
  [/\u2190/g, "<-"],
  [/\u2265/g, ">="],
  [/\u2264/g, "<="],
  [/\u2248/g, "~"],
  [/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " "],
  [/[\u200B-\u200D\u2060\uFEFF]/g, ""],
  [/\u03B1/g, "alpha"],
  [/\u03B2/g, "beta"],
  [/\u03B3/g, "gamma"],
  [/\u03B4/g, "delta"],
  [/\u03BA/g, "kappa"],
  [/\u03BC/g, "\u00B5"],
];

/** Text reduced to Basic Latin and Latin-1 (accents on letters are dropped, other
 *  symbols removed), so drawing it never triggers a font or emoji download. */
export function cardText(text: string): string {
  let t = text ?? "";
  for (const [re, to] of PUNCT) t = t.replace(re, to);
  t = t.normalize("NFKD").replace(/\u03BC/g, "u").replace(/[\u0300-\u036F]/g, "");
  t = t.replace(/[^ -~\u00A1-\u00FF]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

export type CardInput = {
  headline: string;
  standfirst: string;
  authors: string;
  facts: { label: string; value: string }[];
};

export type CardLayout = {
  /** The facts with their text cleaned (see cardText). */
  facts: { label: string; value: string }[];
  headline: string;
  headlineSize: number;
  factSize: number;
  standfirst: string;
  standfirstSize: number;
  authors: string;
};

/** Headline font size by length: 60px for a short one down to 38px. */
export function headlineSize(headline: string): number {
  const n = headline.length;
  return n <= 60 ? 60 : n <= 90 ? 52 : n <= 120 ? 44 : 38;
}

/** Fact font size by the longest value: a 90-character value still fits its
 *  column at the smallest size. */
export function factSize(values: string[]): number {
  const n = Math.max(0, ...values.map((v) => v.length));
  return n <= 40 ? 30 : n <= 60 ? 26 : n <= 80 ? 23 : 21;
}

function oneSentence(text: string, max: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : clean;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return cut.slice(0, sp > max * 0.6 ? sp : max).replace(/[\s,;:.-]+$/, "") + ".";
}

/** The authors on one line: whole names, cut at a comma with "et al." when long. */
export function authorsLine(authors: string): string {
  const a = (authors ?? "").replace(/\s+/g, " ").trim();
  if (a.length <= 90) return a;
  const cut = a.slice(0, 90);
  const comma = cut.lastIndexOf(",");
  return (comma > 20 ? cut.slice(0, comma) : cut.slice(0, cut.lastIndexOf(" "))).trim() + " et al.";
}

export function cardLayout(input: CardInput): CardLayout {
  const headline = cardText(input.headline);
  const standfirst = oneSentence(cardText(input.standfirst), 230);
  const facts = input.facts.map((f) => ({ label: cardText(f.label), value: cardText(f.value) }));
  return {
    facts,
    headline,
    headlineSize: headlineSize(headline),
    factSize: factSize(facts.map((f) => f.value)),
    standfirst,
    standfirstSize: standfirst.length <= 120 ? 34 : 28,
    authors: authorsLine(cardText(input.authors)),
  };
}
