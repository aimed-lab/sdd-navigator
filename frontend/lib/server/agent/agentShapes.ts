// lib/server/agent/agentShapes.ts — what the agent tools return: compact,
// LLM-friendly shapes built from the page views and the Explore backend
// response. Pure (type-only imports), so `npm test` covers it.
//
// Never includes owner ids or other users' emails.

import type { MyPageRow, PageView } from "../pages/pageView";
import type { PageMemberDetail } from "../pages/pageMembers";
import { groupUpdatesByDate } from "../pages/pageViewHelpers.ts";

export const WHATS_NEW_DAYS = 30;
const TOP_RESULTS = 3;

export function pageUrl(origin: string, slug: string): string {
  return `${origin}/pages/${slug}`;
}

export function shapeMyPages(pages: MyPageRow[], origin: string) {
  return {
    pages: pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      url: pageUrl(origin, p.slug),
      visibility: p.visibility,
      role: p.role,
      auto_update: p.refresh_enabled,
      last_updated: p.last_refreshed_at,
      new_items_last_7_days: p.newItems,
    })),
  };
}

/** One page for get_page: notes with their numbered citations, what was added
 *  in the last WHATS_NEW_DAYS days (refresh-added items only, as on the page),
 *  and source counts by kind. */
export function shapePage(
  view: PageView,
  origin: string,
  now: Date = new Date(),
  members?: PageMemberDetail[]
) {
  const evidenceById = new Map(view.evidence.map((e) => [e.id, e]));

  const notes = view.notes.map((n) => ({
    title: n.title,
    body: n.body,
    edited_by_a_person: n.is_human_edited,
    citations: Object.entries(n.citations)
      .map(([num, id]) => ({ n: Number(num), item: evidenceById.get(id) }))
      .filter((c): c is { n: number; item: NonNullable<typeof c.item> } => !!c.item)
      .sort((a, b) => a.n - b.n)
      .map((c) => ({ n: c.n, title: c.item.title, url: c.item.url, kind: c.item.kind })),
  }));

  const cutoff = new Date(now.getTime() - WHATS_NEW_DAYS * 24 * 3600_000).toISOString().slice(0, 10);
  const recent = view.updates.filter((u) => u.occurred_on >= cutoff);
  const whatsNew = groupUpdatesByDate(recent, now).map((g) => ({
    date: g.date,
    headline: g.headline,
    items: g.items.map((u) => ({ title: u.title, url: u.url, kind: u.kind })),
  }));

  const sourceCounts: Record<string, number> = {};
  for (const e of view.evidence) sourceCounts[e.kind] = (sourceCounts[e.kind] ?? 0) + 1;

  return {
    slug: view.page.slug,
    url: pageUrl(origin, view.page.slug),
    title: view.page.title,
    visibility: view.page.visibility,
    your_role: view.viewer.role,
    auto_update: view.page.refresh_enabled,
    last_updated: view.page.last_refreshed_at,
    notes,
    whats_new_last_30_days: whatsNew,
    source_counts: sourceCounts,
    total_sources: view.evidence.length,
    // Only for the owner (the caller passes members only then).
    ...(members ? { members } : {}),
  };
}

/** The Explore backend's response as counts per source plus the top results. */
export function summarizeExplore(json: unknown) {
  const sections = Array.isArray((json as { sections?: unknown })?.sections)
    ? ((json as { sections: unknown[] }).sections as Record<string, unknown>[])
    : [];
  let total = 0;
  const sources = [];
  for (const s of sections) {
    const items = Array.isArray(s?.items) ? (s.items as Record<string, unknown>[]) : [];
    total += items.length;
    if (items.length === 0) continue;
    sources.push({
      source: String(s.kind ?? s.tool ?? "unknown"),
      count: items.length,
      top_results: items.slice(0, TOP_RESULTS).map((i) => ({
        title: String(i.title ?? "").slice(0, 200),
        url: typeof i.url === "string" ? i.url : null,
        kind: String(i.kind ?? s.kind ?? ""),
        date: typeof i.date_iso === "string" ? i.date_iso.slice(0, 10) : null,
      })),
    });
  }
  return { total_results: total, sources };
}

