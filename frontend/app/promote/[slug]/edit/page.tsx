// Edit an existing showcase entry — /promote/[slug]/edit.
//
// Owner only. getOwnedArticleForEdit (lib/server/showcase.ts) returns null
// for a signed-out visitor, an unknown slug, AND a slug that belongs to
// someone else — all three 404 here, identically. That's deliberate: a
// permission error would confirm the slug exists and is someone's private
// draft; a 404 gives a prober nothing to distinguish "never existed" from
// "exists, not yours".
//
// Renders the SAME ArticleEditor the submit flow hands off to — this route
// exists only to reopen it against an existing row instead of a freshly
// created one, not to duplicate it.

import Link from "next/link";
import { notFound } from "next/navigation";
import ArticleEditor from "@/components/promote/ArticleEditor";
import { getOwnedArticleForEdit } from "@/lib/server/showcase";
import { getCommunityById, listMyActiveCommunities } from "@/lib/server/communities";

export const dynamic = "force-dynamic"; // depends on the session

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getOwnedArticleForEdit(slug);
  if (!result) notFound();

  let communities = await listMyActiveCommunities();
  // The article's OWN community may not be in that list — the author
  // deliberately keeps this attachment after leaving (see the migration's
  // own comment on why), which means the picker otherwise wouldn't have an
  // option matching the value it's already showing. Fetched (and appended)
  // only in that one case, so the select still shows the real current
  // community rather than silently falling back to "None" the moment the
  // author reopens this form.
  if (result.entry.communityId && !communities.some((c) => c.id === result.entry.communityId)) {
    const current = await getCommunityById(result.entry.communityId);
    if (current) communities = [...communities, current];
  }

  return (
    <div className="max-w-[1400px] mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <Link
        href={`/promote/${slug}`}
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to article
      </Link>

      <div className="max-w-2xl">
        <h1 className="font-headline-lg text-headline-lg text-on-background">Edit</h1>
        <p className="mt-3 font-body-lg text-body-lg text-secondary">
          {result.entry.published
            ? "This article is live. Changes save as you go — unpublish to take it back down."
            : "This draft isn't public yet. Publish when you're ready."}
        </p>
      </div>

      <div className="mt-10">
        <ArticleEditor
          entry={result.entry}
          media={result.media}
          communities={communities}
          doneHref={`/promote/${slug}`}
        />
      </div>
    </div>
  );
}
