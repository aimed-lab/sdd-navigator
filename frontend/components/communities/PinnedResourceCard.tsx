// "PINNED BY ADMIN" card on the community home: a white card with a 4px UAB Green
// left border, the small label, the title and description on the left and an
// "Open ↗" primary button on the right (stacked under the text on a phone). A
// pinned file also gets a quiet Download link. Files are short-lived signed URLs
// minted per request; a signed-out visitor only gets any when the community is
// 'open' (see the pinned-resource migration), otherwise the resource itself isn't
// returned at all.

import TrackStepLink from "./TrackStepLink";
import type { CommunityResource } from "@/lib/server/communities";
import { downloadHref } from "@/lib/server/communityHome/communityHome";

/** An Open / Download link; records the checklist step when `trackCommunityId` is set. */
function ActionLink({
  trackCommunityId,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { trackCommunityId?: string }) {
  if (trackCommunityId) return <TrackStepLink communityId={trackCommunityId} step="pinned_opened" {...props} />;
  // eslint-disable-next-line jsx-a11y/anchor-has-content
  return <a {...props} />;
}

export default function PinnedResourceCard({
  resource,
  trackCommunityId,
}: {
  resource: CommunityResource;
  /** Pass for an active member: Open / Download tick "Open the pinned resource"
   *  on their welcome checklist. */
  trackCommunityId?: string;
}) {
  const first = resource.files[0];
  const viewHref = first?.url ?? resource.url;

  return (
    <section
      id="pinned"
      aria-label="Pinned by admin"
      className="rounded-2xl bg-white border border-[#e8e4da] border-l-4 border-l-primary px-[18px] py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 scroll-mt-24"
    >
      <div className="min-w-0 flex-1">
        <span className="block text-[11px] leading-4 font-bold tracking-[0.08em] text-primary">PINNED BY ADMIN</span>
        <h2 className="font-title text-[18px] leading-6 text-on-background break-words mt-1">{resource.title}</h2>
        {resource.description && (
          <p className="font-body-md text-[13px] leading-5 text-secondary line-clamp-3 mt-1">{resource.description}</p>
        )}
        {first && (
          <p className="mt-1.5 text-[12.5px] leading-5 text-secondary">
            <ActionLink
              trackCommunityId={trackCommunityId}
              href={downloadHref(first.url, first.filename)}
              className="text-primary hover:underline underline-offset-4"
            >
              Download
            </ActionLink>
            {resource.files.length > 1 ? ` · +${resource.files.length - 1} more file(s)` : ""}
          </p>
        )}
      </div>
      {viewHref && (
        <ActionLink
          trackCommunityId={trackCommunityId}
          href={viewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary shrink-0 self-start sm:self-center whitespace-nowrap px-4 py-2.5 rounded-[10px] text-[13px] font-bold leading-5 inline-flex items-center gap-1.5"
        >
          Open
          <span aria-hidden>↗</span>
        </ActionLink>
      )}
    </section>
  );
}
