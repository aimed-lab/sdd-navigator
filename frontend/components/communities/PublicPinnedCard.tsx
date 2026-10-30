// The "APPLY TO JOIN" card a non-member (signed in or not) sees right under the
// community banner when an admin turned on "Also show the pinned link to
// non-members": the pinned LINK's title and description, a primary "Open form ↗"
// button that opens it in a new tab, and one line saying what happens next. It
// carries only what getPublicPinnedLink() returns (title, description, url): no files,
// no other resources, no members. Server-safe.

import type { PublicPinnedLink } from "@/lib/server/communities";

export default function PublicPinnedCard({ link }: { link: PublicPinnedLink }) {
  return (
    <section
      id="apply"
      aria-label="Apply to join"
      className="rounded-2xl bg-white border border-[#e8e4da] border-l-4 border-l-primary px-[18px] py-4 flex flex-col gap-3 scroll-mt-24"
    >
      <div className="min-w-0">
        <span className="block text-[11px] leading-4 font-bold tracking-[0.08em] text-primary">APPLY TO JOIN</span>
        <h2 className="font-title text-[18px] leading-6 text-on-background break-words mt-1">{link.title}</h2>
        {link.description && (
          <p className="font-body-md text-[13px] leading-5 text-secondary line-clamp-4 mt-1">{link.description}</p>
        )}
      </div>
      <div className="flex flex-col items-start gap-2">
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary whitespace-nowrap px-4 py-2.5 rounded-[10px] text-[13px] font-bold leading-5 inline-flex items-center gap-1.5"
        >
          Open form
          <span aria-hidden>↗</span>
        </a>
        <p className="text-[12.5px] leading-5 text-secondary">After you submit, we&apos;ll add you to the community.</p>
      </div>
    </section>
  );
}
