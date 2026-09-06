// Public article page — /promote/[slug].
//
// PUBLIC, no account required: getPublishedArticleBySlug (lib/server/showcase.ts)
// reads through the ANON Supabase client, never the session client, so this
// page can never leak an unpublished draft through a signed-in owner's
// cookies — the published/owner-draft split is enforced by RLS itself
// (promote_showcase_select_published), and this query's own
// .eq("published", true) is belt-and-suspenders on top of that.
//
// An unknown slug OR an unpublished one both 404 — from the outside there is
// no way to distinguish "never existed" from "exists but private", which is
// the correct behavior for a draft the owner hasn't shared yet.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedArticleBySlug, isOwnerOfShowcase } from "@/lib/server/showcase";
import { estimateReadMinutes, formatPublishedDate } from "@/lib/articleFormat";
import ShareButtons from "@/components/promote/ShareButtons";

export const dynamic = "force-dynamic";

// smartdrugdiscovery.org is the Wix marketing site (a 404 for anything under
// /promote) — the app itself is served from v2.smartdrugdiscovery.org. This
// is the only absolute-URL construction in the app; NEXT_PUBLIC_SITE_URL
// isn't set anywhere yet (not in .env.example/.env.local), so it always
// falls through to this default today.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://v2.smartdrugdiscovery.org";

function articleUrl(slug: string) {
  return `${SITE_URL}/promote/${slug}`;
}

// Turn the "## Heading\n\nparagraph" body generateArticle.ts produces into
// headings + paragraphs. Deliberately not a markdown library — the shape is
// fixed (three known section headings, blank-line-separated paragraphs), so a
// couple of string splits cover it without a new dependency, and an edited
// draft that keeps roughly that shape still renders sensibly.
function renderBody(body: string) {
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block, i) => {
    if (block.startsWith("## ")) {
      return (
        <h2
          key={i}
          className="font-headline-md text-headline-md text-on-background mt-10 mb-3 first:mt-0"
        >
          {block.slice(3).trim()}
        </h2>
      );
    }
    return (
      <p
        key={i}
        className="font-body-lg text-body-lg text-on-background/90 leading-relaxed mb-5 whitespace-pre-wrap"
      >
        {block}
      </p>
    );
  });
}

type PageProps = { params: Promise<{ slug: string }> };

/** The image OG/Twitter/the article body lead with: the first attached
 *  `image`-kind file, falling back to the legacy single `image_url` column
 *  for a pre-media-table entry. Attached-media URLs are signed and
 *  short-lived (10 minutes — see signMediaPath), but this page is
 *  force-dynamic, so generateMetadata re-runs and re-signs on every crawl —
 *  a link-preview fetch always gets a fresh URL, never a stale/expired one. */
function heroImage(article: NonNullable<Awaited<ReturnType<typeof getPublishedArticleBySlug>>>) {
  return article.media.find((m) => m.kind === "image")?.url ?? article.image_url ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) return {};

  const url = articleUrl(article.slug);
  const hero = heroImage(article);
  const images = hero ? [hero] : undefined;

  return {
    title: article.headline,
    description: article.standfirst || undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: article.headline,
      description: article.standfirst || undefined,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: article.headline,
      description: article.standfirst || undefined,
      images,
    },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) notFound();

  // Owner-only "Edit" link. A separate, session-scoped check — the article
  // fetch above deliberately never touches owner_id or the session client
  // (see the file header) — so this can never affect what the public read
  // returns, only whether this ONE link renders.
  const isOwner = await isOwnerOfShowcase(slug);

  const meta = [article.authors, article.journal].filter(Boolean).join(" · ");
  const hero = heroImage(article);
  // Every attached image beyond the hero, plus every slide deck — shown
  // below the body as a simple gallery/download list rather than woven into
  // the prose, since the article text doesn't reference them by position.
  const images = article.media.filter((m) => m.kind === "image");
  const extraImages = hero && images[0]?.url === hero ? images.slice(1) : images;
  const decks = article.media.filter((m) => m.kind === "slides");
  const readMinutes = estimateReadMinutes(article.standfirst, article.articleBody);

  return (
    <article className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      {hero && (
        <div className="w-full rounded-2xl overflow-hidden bg-surface-container-high mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero} alt="" className="w-full max-h-[420px] object-cover" />
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <h1 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
          {article.headline}
        </h1>
        {isOwner && (
          <Link
            href={`/promote/${article.slug}/edit`}
            className="shrink-0 inline-flex items-center gap-1 mt-1 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md"
          >
            <span className="material-symbols-outlined text-base">edit</span>
            Edit
          </Link>
        )}
      </div>

      <p className="mt-3 font-label-md text-label-md text-secondary">
        {article.publishedAt ? formatPublishedDate(article.publishedAt) : null}
        {article.publishedAt && " · "}
        {readMinutes} min read
      </p>

      {article.standfirst && (
        <p className="mt-4 font-body-lg text-body-lg text-secondary">{article.standfirst}</p>
      )}

      {meta && <p className="mt-4 font-body-sm text-body-sm text-secondary">{meta}</p>}

      <div className="mt-8">{renderBody(article.articleBody)}</div>

      {extraImages.length > 0 && (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {extraImages.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m.id}
              src={m.url}
              alt=""
              className="w-full rounded-xl bg-surface-container-high object-cover"
            />
          ))}
        </div>
      )}

      {decks.length > 0 && (
        <div className="mt-8">
          <h2 className="font-label-md text-label-md text-secondary uppercase mb-3">
            Slides &amp; documents
          </h2>
          <ul className="space-y-2">
            {decks.map((m) => (
              <li key={m.id}>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                >
                  <span className="material-symbols-outlined text-base">slideshow</span>
                  {m.filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {article.doi && (
        <p className="mt-10">
          <a
            href={`https://doi.org/${article.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            Read the original paper
            <span className="material-symbols-outlined text-base">open_in_new</span>
          </a>
        </p>
      )}

      <div className="mt-10 border-t border-outline-variant/30 pt-8">
        <ShareButtons url={articleUrl(article.slug)} title={article.headline} />
      </div>
    </article>
  );
}
