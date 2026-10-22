// lib/server/explore/podcastSearch.ts — searching the podcast: episode titles,
// guests and descriptions (and the concepts / tags pulled from each episode)
// AND the transcript text, with the matching snippet to show. Pure, so
// `npm test` covers it; the transcripts are read on the server
// (lib/server/wiki.ts) and only the matches and snippets reach the browser.
//
// A term matches a word when it is a PREFIX of it ("deliv" finds "delivery",
// but "ai" does not match inside "available"); every term must match somewhere
// in the episode (AND), and the terms may be in different fields.

export type SearchableEpisode = {
  id: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  concepts: { title: string }[];
  transcript: string;
  episode_number: number | null;
  image_url: string | null;
};

export type MatchField = "episode" | "title" | "description" | "topics" | "transcript";

export type Snippet = { text: string; field: MatchField };

export type PodcastHit = {
  id: string;
  slug: string;
  title: string;
  episode_number: number | null;
  image_url: string | null;
  description: string;
  tags: string[];
  /** Where it matched best: a title hit beats a description / topics hit beats a transcript hit. */
  field: MatchField;
  /** The passage to show with the hit; null when nothing but the title matched. */
  snippet: Snippet | null;
  score: number;
};

/** The episode number a query asks for: "33", "#33", "ep 33", "ep. 33",
 *  "episode 33" (nothing else in the query), or null. */
export function episodeNumberQuery(query: string): number | null {
  const m = query.trim().match(/^(?:ep(?:isode)?\.?\s*)?#?\s*(\d{1,4})$/i);
  return m ? Number(m[1]) : null;
}

export function queryTerms(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])).slice(0, 8);
}

type Word = { word: string; start: number; end: number };

function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /[A-Za-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  return out;
}

const hasTerm = (ws: Word[], term: string) => ws.some((w) => w.word.startsWith(term));

/** The index of the first word that starts with any of the terms, or -1. */
function firstHit(ws: Word[], terms: string[]): number {
  return ws.findIndex((w) => terms.some((t) => w.word.startsWith(t)));
}

const SNIPPET_RADIUS = 90;

/** About 180 characters of `text` around the first matching word, cut at word
 *  edges, with an ellipsis where it was trimmed. Null when no term occurs. */
export function snippetAround(text: string, terms: string[]): string | null {
  const ws = words(text);
  const i = firstHit(ws, terms);
  if (i < 0) return null;
  let start = Math.max(0, ws[i].start - SNIPPET_RADIUS);
  let end = Math.min(text.length, ws[i].end + SNIPPET_RADIUS);
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp >= 0 && sp < ws[i].start) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > ws[i].end) end = sp;
  }
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "… " : "") + body + (end < text.length ? " …" : "");
}

/** Splits text into plain and highlighted pieces for rendering. */
export function highlightParts(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (terms.length === 0) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const w of words(text)) {
    if (terms.some((t) => w.word.startsWith(t))) {
      if (w.start > last) parts.push({ text: text.slice(last, w.start), hit: false });
      parts.push({ text: text.slice(w.start, w.end), hit: true });
      last = w.end;
    }
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

/** Episodes matching the query, best first: title matches, then description /
 *  topics, then transcript-only matches; newer episodes first within a tier. */
export function searchEpisodes(episodes: SearchableEpisode[], query: string): PodcastHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  // "33" / "ep 33" / "episode 33": that episode comes first, then any text matches
  // (so "33" never ranks a transcript's "334%" above episode 33 itself).
  const wanted = episodeNumberQuery(query);

  const hits: PodcastHit[] = [];
  for (const e of episodes) {
    const isWanted = wanted !== null && e.episode_number === wanted;
    // "ep"/"episode" are not words to find in the text; only the number is.
    const textTerms = wanted !== null ? [String(wanted)] : terms;
    if (isWanted) {
      hits.push({
        id: e.id,
        slug: e.slug,
        title: e.title,
        episode_number: e.episode_number,
        image_url: e.image_url,
        description: e.description ?? "",
        tags: e.tags ?? [],
        field: "episode",
        snippet: null,
        score: 1_000_000,
      });
      continue;
    }
    const title = words(e.title);
    const description = words(e.description ?? "");
    const topicsText = [...(e.tags ?? []), ...(e.concepts ?? []).map((c) => c.title)].join(" ");
    const topics = words(topicsText);
    const transcript = words(e.transcript ?? "");

    // Every term must be found somewhere in the episode.
    if (!textTerms.every((t) => hasTerm(title, t) || hasTerm(description, t) || hasTerm(topics, t) || hasTerm(transcript, t))) continue;

    const inTitle = textTerms.filter((t) => hasTerm(title, t)).length;
    const inMeta = textTerms.filter((t) => hasTerm(description, t) || hasTerm(topics, t)).length;
    const field: MatchField =
      inTitle > 0 ? "title" : inMeta > 0 ? (textTerms.some((t) => hasTerm(description, t)) ? "description" : "topics") : "transcript";
    const score = inTitle * 100 + inMeta * 10 + textTerms.filter((t) => hasTerm(transcript, t)).length;

    // The snippet comes from the most informative text that contains a term:
    // the description, else the transcript.
    let snippet: Snippet | null = null;
    const fromDescription = snippetAround(e.description ?? "", textTerms);
    if (fromDescription) snippet = { text: fromDescription, field: "description" };
    else {
      const fromTranscript = snippetAround(e.transcript ?? "", textTerms);
      if (fromTranscript) snippet = { text: fromTranscript, field: "transcript" };
    }

    hits.push({
      id: e.id,
      slug: e.slug,
      title: e.title,
      episode_number: e.episode_number,
      image_url: e.image_url,
      description: e.description ?? "",
      tags: e.tags ?? [],
      field,
      snippet,
      score,
    });
  }

  return hits.sort((a, b) => b.score - a.score || (b.episode_number ?? 0) - (a.episode_number ?? 0));
}
