// lib/articleFormat.ts — small, dependency-free formatting helpers shared by
// the public article page (app/promote/[slug]/page.tsx, a server component)
// and the gallery card (components/promote/ShowcaseCard.tsx, a client
// component). Pulled out specifically so the "N min read" math and the
// publish-date formatting can't drift between the two — before this they
// were duplicated (the card didn't have them at all yet).

/** ~200 wpm, rounded, floored at 1 minute — standard estimated-read-time
 *  math, same rough rate every "N min read" badge on a news site uses.
 *  Counts the standfirst too since it's read before the body is. */
export function estimateReadMinutes(standfirst: string, body: string): number {
  const words = `${standfirst} ${body}`.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function formatPublishedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// smartdrugdiscovery.org is the Wix marketing site (a 404 for anything under
// /promote) — the app itself is served from v2.smartdrugdiscovery.org. This
// is the only absolute-URL construction in the app; NEXT_PUBLIC_SITE_URL
// isn't set anywhere yet (not in .env.example/.env.local), so it always
// falls through to this default today. Reads NEXT_PUBLIC_ (not a plain env
// var) specifically so this also works from ArticleEditor.tsx, a client
// component — Next.js inlines NEXT_PUBLIC_ vars into the client bundle at
// build time.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://v2.smartdrugdiscovery.org";

/** The public URL for a published (or draft — the slug exists from the
 *  moment the row does) article. Shared by the article page itself and by
 *  the LinkedIn post's "{{ARTICLE_LINK}}" substitution (ShareButtons.tsx,
 *  ArticleEditor.tsx) so there is exactly one place that knows the shape of
 *  a /promote/[slug] URL. */
export function articleUrl(slug: string): string {
  return `${SITE_URL}/promote/${slug}`;
}

/** Replace the LinkedIn post's "{{ARTICLE_LINK}}" placeholder (see
 *  generateArticle.ts) with a real article URL. A no-op on text that
 *  doesn't contain the placeholder, so it's safe to call unconditionally —
 *  on a post that's already been substituted (ArticleEditor.tsx does this
 *  every render, so nobody, not even a row written before this helper
 *  existed, ever sees the raw placeholder), or on one that never had it.
 *  Takes the URL itself, not a slug, so callers that already built one
 *  (ShareButtons.tsx's `url` prop) don't reconstruct it a second way. */
export function withArticleLink(linkedinPost: string, url: string): string {
  return linkedinPost.replaceAll("{{ARTICLE_LINK}}", url);
}
