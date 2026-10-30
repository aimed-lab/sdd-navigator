// The community page header: a green banner card with the name and purpose on
// the left, and on the right a white card with Join, Share and the QR code.
// A server component; the interactive bits (JoinLeaveControl, CopyLinkButton,
// JoinQr) are the client components it renders.

import type { Community, Membership } from "@/lib/server/communities";
import { eyebrow, initials, plural, shortDate } from "@/lib/server/communityHome/communityHome";
import JoinLeaveControl from "./JoinLeaveControl";
import CopyLinkButton from "./CopyLinkButton";
import JoinQr from "./JoinQr";

export default function CommunityHeader({
  community,
  membership,
  memberNames,
  memberCount,
  pageCount,
  updatedAt,
  autoOpenJoin = false,
}: {
  autoOpenJoin?: boolean;
  community: Pick<Community, "id" | "slug" | "name" | "description" | "is_open">;
  membership: Membership;
  /** Names to draw initials for; empty when the roster isn't visible to this viewer. */
  memberNames: string[];
  memberCount: number;
  /** Null when the viewer can't see the member pages (it is then left out). */
  pageCount: number | null;
  updatedAt: string | null;
}) {
  const shown = memberNames.slice(0, 5);
  const stats = [
    plural(memberCount, "member"),
    // Hidden when there are none (a brand-new community).
    pageCount ? plural(pageCount, "wiki page") : null,
    updatedAt ? `updated ${shortDate(updatedAt)}` : null,
  ].filter(Boolean);

  return (
    <header className="rounded-2xl bg-primary text-on-primary overflow-hidden">
      {/* Height follows the content: the left column does not stretch to the
          join card, and the banner has only a modest minimum. */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-6 p-6 sm:p-7 min-h-[11rem]">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <span className="font-label-sm text-label-sm tracking-widest text-on-primary/80">
            {eyebrow(community.is_open)}
          </span>
          <h1 className="font-headline-lg text-headline-lg text-on-primary break-words">{community.name}</h1>
          {community.description && (
            <p className="font-body-lg text-body-lg text-on-primary/90 max-w-2xl">{community.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            {shown.length > 0 && (
              <div className="flex -space-x-2" aria-hidden>
                {shown.map((n, i) => (
                  <span
                    key={i}
                    className="w-8 h-8 rounded-full bg-white/90 text-primary border-2 border-primary flex items-center justify-center font-label-sm text-[11px] font-semibold"
                  >
                    {initials(n)}
                  </span>
                ))}
              </div>
            )}
            <span className="font-body-sm text-body-sm text-on-primary/90">{stats.join(" · ")}</span>
          </div>
        </div>

        <div className="lg:w-64 shrink-0 rounded-xl bg-surface-container-lowest text-on-background p-4 flex flex-col items-stretch gap-3 shadow-sm">
          <JoinLeaveControl
            communityId={community.id}
            communityName={community.name}
            slug={community.slug}
            isOpen={community.is_open}
            membership={membership}
            autoOpenJoin={autoOpenJoin}
          />
          <CopyLinkButton
            slug={community.slug}
            label="Share · copy link"
            communityId={membership.state === "active" ? community.id : undefined}
          />
          <div className="border-t border-outline-variant/30 pt-3">
            <JoinQr slug={community.slug} name={community.name} isAdmin={membership.isAdmin} />
          </div>
        </div>
      </div>
    </header>
  );
}
