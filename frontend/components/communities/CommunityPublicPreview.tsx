// The pitch for a non-member — rendered right under the name/purpose
// header, before anyone has to click Join to find out whether this
// community is actually active. Server component: everything it's given
// is already RLS-filtered (getCommunityFeedPreview) or public
// (memberCount, from getCommunityStats) by the time it reaches here — this
// component makes no reads of its own.
//
// Only ever rendered when the caller has already decided public_preview is
// 'standard' AND the viewer isn't a member — see
// app/communities/[slug]/page.tsx's own call site. A 'minimal' community
// renders nothing here at all, not an empty version of this component.
//
// Deliberately NOT a CollapsibleSection: this is the thing meant to
// persuade someone before they've committed to exploring the page, not
// content to tuck behind a click.

import type { CommunityFeedPreview } from "@/lib/server/communities";

export default function CommunityPublicPreview({
  memberCount,
  feedPreview,
}: {
  memberCount: number;
  feedPreview: CommunityFeedPreview;
}) {
  return (
    <section className="glass-panel rounded-xl p-6 flex flex-col gap-4">
      <p className="font-body-md text-body-md text-on-background">
        {memberCount} {memberCount === 1 ? "member" : "members"}
        {feedPreview.count > 0 && (
          <>
            {" · "}
            {feedPreview.count} {feedPreview.count === 1 ? "item" : "items"} in the feed
          </>
        )}
      </p>

      {feedPreview.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {feedPreview.items.map((item, i) => (
            <li key={i} className="font-body-sm text-body-sm text-on-background truncate">
              {item.title}
              {item.source && <span className="text-secondary"> · {item.source}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
