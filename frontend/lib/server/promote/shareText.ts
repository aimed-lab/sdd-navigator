// lib/server/promote/shareText.ts — the Promote share links and the ready-to-post
// drafts per platform. Pure (no imports), so `npm test` covers it and client
// components may use it.
//
// Every link is built from the site URL config, never a hardcoded host. Drafts
// are assembled from the author's own headline, standfirst and key facts: no
// model call and nothing composed about people, so no invented quotes.
//
// A stored draft keeps "{{ARTICLE_LINK}}" where the link goes (the slug can
// change when a draft is first published); fillLink() substitutes it at use.

export const ARTICLE_LINK = "{{ARTICLE_LINK}}";

/** The public site, used for every share link, og:url and canonical. */
export const DEFAULT_SITE_URL = "https://connect.smartdrugdiscovery.org";

/** `NEXT_PUBLIC_SITE_URL` when it is a valid http(s) origin, else the default.
 *  A trailing slash or path is dropped. */
export function siteUrl(configured?: string | null): string {
  const v = (configured ?? "").trim();
  if (v) {
    try {
      const u = new URL(v);
      if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
    } catch {
      /* fall through to the default */
    }
  }
  return DEFAULT_SITE_URL;
}

export function articleUrlFor(base: string, slug: string): string {
  return `${base.replace(/\/+$/, "")}/promote/${slug}`;
}

export function cardImageUrlFor(base: string, slug: string): string {
  return `${articleUrlFor(base, slug)}/opengraph-image`;
}

// ── limits ───────────────────────────────────────────────────────────────────

export const LINKEDIN_LIMIT = 1300;
/** "Under 280" including the link, counted as raw characters (stricter than
 *  X's own 23-character link rule). */
export const SHORT_LIMIT = 279;

export type Platform = "linkedin" | "x" | "bluesky";
export const PLATFORM_LIMIT: Record<Platform, number> = {
  linkedin: LINKEDIN_LIMIT,
  x: SHORT_LIMIT,
  bluesky: SHORT_LIMIT,
};

export type ShareTexts = { linkedin: string; x: string; bluesky: string };

export function fillLink(text: string, url: string): string {
  return text.split(ARTICLE_LINK).join(url);
}

/** Length of a draft once its link is filled in. */
export function shareLength(text: string, url: string): number {
  return fillLink(text, url).length;
}

export function withinLimit(platform: Platform, text: string, url: string): boolean {
  return shareLength(text, url) <= PLATFORM_LIMIT[platform];
}

// ── compose links ────────────────────────────────────────────────────────────

export function xComposeUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export function blueskyComposeUrl(text: string): string {
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`;
}

/** LinkedIn cannot prefill text: this opens its share dialog on the link. */
export function linkedinShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

// ── drafts ───────────────────────────────────────────────────────────────────

const TYPE_HASHTAG: Record<string, string> = {
  paper: "#NewPaper",
  preprint: "#Preprint",
  talk: "#ConferenceTalk",
  poster: "#Poster",
  event: "#Event",
  achievement: "#ResearchNews",
  breakthrough: "#Breakthrough",
  partnership: "#Collaboration",
  funding: "#Funding",
  tool: "#OpenScience",
  service: "#ResearchSupport",
  dataset: "#OpenData",
  other: "#Research",
};

/** Up to three hashtags: the type's own, then the item's own tags. */
export function hashtagsFor(type: string, tags: string[] = []): string[] {
  const out: string[] = [TYPE_HASHTAG[type] ?? "#Research"];
  for (const t of tags) {
    const word = t.replace(/[^A-Za-z0-9]+/g, "");
    const tag = word ? `#${word}` : "";
    if (tag && tag.length <= 24 && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

function sentence(text: string, max: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : clean;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

export type ShareSource = {
  type: string;
  headline: string;
  standfirst: string;
  /** Key facts as {label, value}; blank values are skipped. */
  facts: { label: string; value: string }[];
  tags?: string[];
  /** The real URL, used only to budget the short texts' length. */
  url: string;
};

/** The "key finding" line: the last non-blank fact (paper: what we found;
 *  event: who should come), else the second sentence of the standfirst. */
function keyLine(src: ShareSource): string {
  const vals = src.facts.map((f) => f.value.trim()).filter(Boolean);
  return vals.length > 0 ? vals[vals.length - 1] : "";
}

/** Hook: the first sentence of the standfirst when there is one, else the headline. */
function hook(src: ShareSource): string {
  return sentence(src.standfirst, 200) || sentence(src.headline, 200);
}

/** Ready-to-post text for each platform. LinkedIn is at most 1,300 characters
 *  with a plain-language hook, the key finding, the link, a tags placeholder
 *  and 1-3 hashtags. X and Bluesky are under 280 characters including the link. */
export function draftShareTexts(src: ShareSource): ShareTexts {
  const tags = hashtagsFor(src.type, src.tags);
  const headline = sentence(src.headline, 120);

  // LinkedIn
  const parts: string[] = [];
  const h = hook(src);
  if (h) parts.push(h);
  const finding = keyLine(src);
  if (finding && sentence(finding, 400) !== h) parts.push(sentence(finding, 400));
  const middle = parts.join("\n\n");
  const linkBlock = `${headline ? headline + "\n" : ""}${ARTICLE_LINK}`;
  const tail = `Tagging: @[collaborator] @[institution]\n${tags.join(" ")}`;
  let linkedin = [middle, linkBlock, tail].filter(Boolean).join("\n\n");
  if (shareLength(linkedin, src.url) > LINKEDIN_LIMIT) {
    const room = LINKEDIN_LIMIT - shareLength([linkBlock, tail].join("\n\n"), src.url) - 4;
    linkedin = [sentence(middle, Math.max(40, room)), linkBlock, tail].join("\n\n");
  }

  // X and Bluesky: hook, link, one hashtag when it fits.
  const short = (): string => {
    const link = ARTICLE_LINK;
    const budget = SHORT_LIMIT - src.url.length - 2; // "\n\n" before the link
    const tag = tags[0];
    const withTag = (body: string) => `${body}\n\n${link}\n${tag}`;
    const lead = sentence(src.standfirst, 200) || headline;
    for (const text of [lead, headline]) {
      if (!text) continue;
      const candidate = withTag(text);
      if (shareLength(candidate, src.url) <= SHORT_LIMIT) return candidate;
      const plain = `${text}\n\n${link}`;
      if (shareLength(plain, src.url) <= SHORT_LIMIT) return plain;
    }
    return `${sentence(lead || headline, Math.max(20, budget))}\n\n${link}`;
  };
  const x = short();

  return { linkedin, x, bluesky: x };
}

/** A stored share_text jsonb -> the three strings (blank when absent). */
export function normalizeShareTexts(raw: unknown): ShareTexts {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return { linkedin: s(o.linkedin), x: s(o.x), bluesky: s(o.bluesky) };
}

/** True when nothing has been drafted or written yet. */
export function shareTextsEmpty(t: ShareTexts): boolean {
  return !t.linkedin.trim() && !t.x.trim() && !t.bluesky.trim();
}
