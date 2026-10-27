// /pages — "Your wiki": the wiki pages the signed-in user owns, plus the team
// pages they are a member of. Signed-out visitors are redirected to login
// (same shape as /projects). Read through the visitor's own session, so RLS
// decides what is listed.

import { ASSISTANT_ENABLED } from "@/lib/siteMode";
import Link from "next/link";
import { redirect } from "next/navigation";
import DeletedNotice, { wasDeleted } from "@/components/DeletedNotice";
import NewWikiPageButton from "@/components/pages/NewWikiPageButton";
import VisibilityBadge from "@/components/pages/VisibilityBadge";
import { listMyPages } from "@/lib/server/pages/pageView";
import { formatDay } from "@/lib/server/pages/pageViewHelpers";
import { siteTitle } from "@/lib/siteMode";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: siteTitle("Your wiki") };

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;

export default async function MyPagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const result = await listMyPages();
  if (result.status === "signed_out") redirect("/login?callbackUrl=%2Fpages");

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20 flex flex-col gap-10">
      <section className="border-b border-outline-variant/30 pb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
        <div>
          <h1 className="font-display-lg text-[40px] leading-tight text-on-background">Your wiki</h1>
          <p className="mt-2 font-body-md text-body-md text-secondary max-w-2xl">
            Wiki pages you own and team pages you belong to. Each one keeps collecting new research on its own.
          </p>
        </div>
        <div className="shrink-0">
          <NewWikiPageButton />
        </div>
      </section>

      <DeletedNotice show={wasDeleted(sp)} />

      {result.status === "error" && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          Couldn&apos;t load your wiki pages. Please try again.
        </p>
      )}

      {result.status === "ok" && result.pages.length === 0 && (
        <div className="glass-panel rounded-2xl p-10 text-center max-w-2xl flex flex-col items-center gap-5">
          <p className="font-body-md text-body-md text-secondary">
            {ASSISTANT_ENABLED
              ? <>No wiki pages yet. Ask the assistant &ldquo;make me a page on &lt;your topic&gt;&rdquo; or click New wiki page.</>
              : "No wiki pages yet."}
          </p>
          <NewWikiPageButton />
        </div>
      )}

      {result.status === "ok" && result.pages.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">
          {result.pages.map((p) => {
            const updated = formatDay(p.last_refreshed_at);
            return (
              <li key={p.id}>
                <Link href={`/pages/${p.slug}`} className="glass-card block rounded-xl p-6 h-full">
                  <div className="flex flex-wrap items-center gap-2">
                    <VisibilityBadge visibility={p.visibility} />
                    {p.role !== "owner" && (
                      <span className="font-label-sm text-label-sm text-secondary">{ROLE_LABEL[p.role]}</span>
                    )}
                  </div>
                  <h2 className="mt-3 font-title text-[22px] leading-tight font-medium text-on-background line-clamp-3">
                    {p.title}
                  </h2>
                  <p className="mt-3 font-body-sm text-body-sm text-secondary">
                    {updated ? `Updated ${updated}` : "Not updated yet"}
                  </p>
                  <p className="mt-1 font-body-sm text-body-sm text-on-background">
                    {p.newItems === 0
                      ? "Nothing new in the last 7 days"
                      : `${p.newItems} new ${p.newItems === 1 ? "item" : "items"} in the last 7 days`}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
