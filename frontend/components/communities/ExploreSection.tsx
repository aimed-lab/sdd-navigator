"use client";

// The community's Explore section — the agent's findings, split out of
// what used to be part of Resources so the two claims ("this is what we
// have" vs. "this is what Explore turned up") are two independently
// enabled/reordered sections in the same section system, not one heading
// conflating both. Resources is now ONLY hand-curated items (see
// ResourcesSection.tsx's own comment); everything here is
// machine-generated, stored by refreshCommunityFeed
// (lib/server/communities.ts) and never live — a member sees whatever the
// last Refresh found, same as before. The admin controls that drive this
// (Sources/Topics/Refresh) live in ExploreFeedEditor, inside "Manage
// community" — unchanged by this split, they just now describe what feeds
// THIS section instead of half of Resources.
//
// Read-only, no admin add-form — a Refresh regenerates the whole set (see
// refreshCommunityFeed's own comment on wipe-then-insert), so there's
// nothing here for an admin to hand-add or edit.
//
// GROUPED BY EXPLORE KIND, same "small uppercase label per non-empty
// group" idiom ResourcesSection uses for resource_type — a different
// vocabulary (the item's actual source: paper, trial, dataset, ...), so
// its own set of groups, not merged into Resources'.
//
// PROVENANCE: no per-row badge — every card here already lives under a
// section titled "Explore"; the heading already says where these came
// from, so repeating it per row (the "Found via Explore · pubmed" this
// section replaces) would say the same thing a second time for nothing.

import { useState } from "react";
import type { CommunityFeedItem } from "@/lib/server/communities";
import { EXPLORE_SOURCE_KEYS, EXPLORE_SOURCE_LABEL } from "@/lib/communityTypes";
import ItemCard from "@/components/ItemCard";
import SaveItemPicker from "@/components/SaveItemPicker";
import type { ExploreItem } from "@/types/explore";
import CollapsibleSection from "./CollapsibleSection";

/** CommunityFeedItem (the DB row) -> ExploreItem (what ItemCard actually
 *  renders) — the whole point of storing `raw`/`signal` verbatim
 *  (refreshCommunityFeed, lib/server/communities.ts) was to make this
 *  reconstruction lossless for everything ItemCard reads. `doi` and
 *  `dedupe_key` are the two ExploreItem fields with no column here; both
 *  are safe to drop — ItemCard never reads either (grep confirms: it only
 *  ever touches id/kind/title/summary/url/source/date_iso/signal/raw). */
function feedItemToExploreItem(row: CommunityFeedItem): ExploreItem {
  return {
    id: row.external_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.source ?? "",
    date_iso: row.published_at,
    signal: row.signal,
    raw: row.raw ?? undefined,
  };
}

/** How many items show per kind group before "Show all N" — see
 *  ExpandableFeedGroup. Ninety papers in one flat list reads as a wall,
 *  not a feed; this keeps the common case (a handful of genuinely new
 *  items) scannable while still making the full set one click away. */
const FEED_GROUP_COLLAPSED_LIMIT = 10;

/** One kind's items, rendered through the SAME ItemCard Explore uses
 *  (components/ItemCard.tsx) — same colored top-border-by-kind, same
 *  clamped title, same per-kind metadata blocks (organism for a dataset,
 *  trial status, ChEMBL phase, Open Targets evidence, ...), same grid
 *  Explore itself lays these out in (app/explore/page.tsx's own GRID
 *  constant).
 *
 *  No `projectId` passed — a community isn't a project, so there's no
 *  single obvious save target. `onSaveClick` (from ExploreSection) opens
 *  SaveItemPicker instead of ItemCard's own local/project toggle — a real
 *  persisted save (to a project, a NEW project, or the viewer's own saved
 *  items), never a silent-reset-on-reload local toggle. Only ever passed
 *  when `interactive` — see below.
 *
 *  INTERACTIVE (the member view, unchanged): capped at
 *  FEED_GROUP_COLLAPSED_LIMIT with a "Show all N" expander — a community
 *  with ninety papers stored otherwise renders as one unbroken wall under
 *  the "Papers" heading.
 *
 *  NOT INTERACTIVE (a non-member viewing an 'open' community's feed,
 *  2026-09-20_community_public_roster.sql): every item renders directly,
 *  no cap, no expander — "fully visible" means the whole stored feed is
 *  there to look at, and there's nothing left to expand INTO once nothing
 *  was held back. Each card itself is also non-interactive (ItemCard's own
 *  `interactive` prop) — no click-through, no bookmark.
 *
 *  Either way `items` arrives pre-sorted newest-published-first
 *  (listCommunityFeedItems' own ORDER BY), so a capped slice is always the
 *  N most recent, not an arbitrary N. */
function ExpandableFeedGroup({
  items,
  onSaveClick,
  interactive,
}: {
  items: CommunityFeedItem[];
  onSaveClick?: (item: ExploreItem) => void;
  interactive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = interactive
    ? expanded
      ? items
      : items.slice(0, FEED_GROUP_COLLAPSED_LIMIT)
    : items;
  const hiddenCount = items.length - visible.length;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {visible.map((item) => (
          <ItemCard
            key={item.id}
            item={feedItemToExploreItem(item)}
            onSaveClick={onSaveClick}
            interactive={interactive}
          />
        ))}
      </div>
      {interactive && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 font-label-sm text-label-sm text-primary hover:underline underline-offset-4"
        >
          Show all {items.length}
        </button>
      )}
    </>
  );
}

export default function ExploreSection({
  title,
  defaultOpen,
  feedItems,
  interactive = true,
}: {
  title: string;
  defaultOpen?: boolean;
  /** The community's STORED Explore feed (listCommunityFeedItems) — as of
   *  the last Refresh, never a live search. */
  feedItems: CommunityFeedItem[];
  /** False for a non-member viewing an 'open' community's feed — "fully
   *  visible but not interactive": every item shown (no collapse/expander),
   *  each card look-only (no click-through, no bookmark). Default true,
   *  the member view, unchanged. See ExpandableFeedGroup's own comment. */
  interactive?: boolean;
}) {
  const [savingItem, setSavingItem] = useState<ExploreItem | null>(null);

  return (
    <CollapsibleSection title={title} count={feedItems.length} defaultOpen={defaultOpen}>
      {feedItems.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary">
          Nothing found yet. An admin can pick sources and topics, then refresh, from Manage
          community.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {EXPLORE_SOURCE_KEYS.map((kind) => {
            const group = feedItems.filter((i) => i.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <span className="block font-label-sm text-label-sm text-secondary/70 uppercase mb-2">
                  {EXPLORE_SOURCE_LABEL[kind]}
                </span>
                <ExpandableFeedGroup
                  items={group}
                  onSaveClick={interactive ? setSavingItem : undefined}
                  interactive={interactive}
                />
              </div>
            );
          })}
        </div>
      )}

      {savingItem && <SaveItemPicker item={savingItem} onClose={() => setSavingItem(null)} />}
    </CollapsibleSection>
  );
}
