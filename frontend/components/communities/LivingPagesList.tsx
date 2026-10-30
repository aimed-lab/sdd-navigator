// The "Wiki pages" tab: wiki pages created by this community's members
// that the viewer may read (public, or team pages they belong to). Private
// pages never appear; the database decides, this just lists what came back.

import Link from "next/link";
import NewWikiPageButton from "@/components/pages/NewWikiPageButton";
import type { MemberLivingPage } from "@/lib/server/communities";
import { shortDate } from "@/lib/server/communityHome/communityHome";

export default function LivingPagesList({ pages }: { pages: MemberLivingPage[] }) {
  if (pages.length === 0) {
    return (
      <div className="rounded-2xl glass-panel p-6">
        <p className="font-body-md text-body-md text-secondary">
          No wiki pages yet. When a member shares a public wiki page, or a team page you are on, it shows up here.
          Ask the assistant &ldquo;make me a page on &lt;your topic&gt;&rdquo; to start one.
        </p>
        <div className="mt-4">
          <NewWikiPageButton />
        </div>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {pages.map((p) => (
        <li key={p.slug}>
          <Link
            href={`/pages/${p.slug}`}
            className="h-full rounded-2xl glass-panel p-5 flex flex-col gap-2 hover:border-primary transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm text-secondary">
              <span className="material-symbols-outlined text-[16px]">{p.visibility === "public" ? "public" : "group"}</span>
              {p.visibility === "public" ? "Public" : "Team"}
            </span>
            <span className="font-headline-sm text-headline-sm text-on-background break-words">{p.title}</span>
            <span className="font-body-sm text-body-sm text-secondary">
              {p.seed_input && p.seed_input !== p.title ? `${p.seed_input} · ` : ""}
              updated {shortDate(p.last_refreshed_at ?? p.updated_at)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
