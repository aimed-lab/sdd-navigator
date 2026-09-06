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
