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
//
// LAYOUT. Most arrivals here come from a shared link, not from browsing the
// site, so the page has to answer "what is this and where am I" itself,
// before the reader decodes anything else:
//   1. Eyebrow — SPARC SHOWCASE + the category pill. Prior version opened
//      straight into the hero image with no site identity at all.
//   2. Headline, standfirst, byline (authors · date · read time) — in that
//      order, ABOVE the image. A reader should know what the piece is
//      before decoding a picture.
//   3. Hero image — full width of the page's own 900px column, wider than
//      the prose, since a narrow-text/wide-image split is the standard
//      editorial pattern and an image capped to the 680px prose column
//      reads as small and incidental, not the visual anchor of the page.
//      Natural aspect ratio, no crop, no letterbox: a conference poster is
//      tall, a figure is wide, a screenshot is square, and forcing all of
//      them into one fixed ratio (16:9 was tried) produces heavy empty
//      bars. max-h-[70vh] is the only constraint, so a very tall poster
//      can't dominate the whole screen — width is otherwise free to be
//      anything up to the 900px column.
//
// TWO WIDTHS, ONE PAGE. The outer column is 900px; the eyebrow/headline/
// standfirst/byline block and everything after the hero (body, extra media,
// DOI link, share buttons) each sit in their own nested max-w-[680px]
// wrapper. Only the hero itself uses the full 900px. 680px is what keeps
// body text at a comfortable reading measure — the previous max-w-3xl
// (768px) pushed it past 80-90 characters per line. 680px at the 18px body
// size here lands around 68 characters per line.
//
// PRESENCE WITHOUT DECORATION. A research showcase page with no visual
// identity of its own — strip the nav bar and it's indistinguishable from
// any other article template. Three deliberately restrained moves, no new
// tokens:
//   - The header (eyebrow through byline) sits on a full-page-width
//     bg-primary/5 band — the ONE full-bleed element on the page, a
//     sibling BEFORE the max-w-[900px] <article>, not nested inside it,
//     specifically so it can span edge to edge while the header text
//     inside it still holds to 680px. The hero sits below the band, in
//     the article, not inside it.
//   - Section headings are text-primary instead of text-on-background —
//     chosen over a green rule above each heading: a rule is an added
//     decorative element (one more thing drawn on the page), while a
//     colour change costs nothing extra and does the SAME job — giving
//     scroll rhythm — using a value already applied everywhere else on
//     this page (the eyebrow, the pills, the DOI link). Simpler wins here.
//   - Share row: LinkedIn is the one platform this feature is actually
//     built around, so it's the only filled (btn-primary) button;
//     Facebook/X/Copy link stay btn-outline — see ShareButtons.tsx.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedArticleBySlug, isOwnerOfShowcase } from "@/lib/server/showcase";
import { estimateReadMinutes, formatPublishedDate } from "@/lib/articleFormat";
import { LEGACY_SHOWCASE_TYPE_LABEL, SHOWCASE_TYPE_LABEL } from "@/lib/showcaseTypes";
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
      // 24px/40px-above/12px-below groups a heading with ITS OWN text
      // rather than reading as floating space between two sections —
      // font-headline-md/text-headline-md is already the 24px/32px/600
      // token, and mt-10/mb-3 are Tailwind's own 40px/12px, so this needed
      // no arbitrary values. text-primary (not text-on-background/a rule
      // above) is what gives the page scroll rhythm — see the file header
      // for why that reading won over a green rule.
      return (
        <h2 key={i} className="font-headline-md text-headline-md text-primary mt-10 mb-3 first:mt-0">
          {block.slice(3).trim()}
        </h2>
      );
    }
    return (
      <p
        key={i}
        // 18px/1.7, explicit arbitrary values rather than the text-body-lg
        // token (18px/28px, i.e. 1.56) — the token's bundled line-height
        // isn't the 1.7 asked for here, and after this session's line-clamp
        // cascade surprise, compositing a sized token with an overriding
        // leading-[] utility isn't a risk worth taking versus just being
        // explicit about both.
        className="font-body-lg text-[18px] leading-[1.7] text-on-background/90 mb-5 whitespace-pre-wrap"
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

  const typeLabel =
    (SHOWCASE_TYPE_LABEL as Record<string, string>)[article.type] ??
    LEGACY_SHOWCASE_TYPE_LABEL[article.type] ??
    article.type;

  const hero = heroImage(article);
  // Every attached image beyond the hero, plus every slide deck — shown
  // below the body as a simple gallery/download list rather than woven into
  // the prose, since the article text doesn't reference them by position.
  const images = article.media.filter((m) => m.kind === "image");
  const extraImages = hero && images[0]?.url === hero ? images.slice(1) : images;
  const decks = article.media.filter((m) => m.kind === "slides");
  const readMinutes = estimateReadMinutes(article.standfirst, article.articleBody);

  // Authors, then date, then read time — the byline row, in that fixed
  // order. Journal used to sit in a separate line here; it's dropped from
  // the header now that the eyebrow's category pill carries that context,
  // and it's still available via the DOI link below for anyone who wants
  // the citation itself.
  const byline = [
    article.authors || null,
    article.publishedAt ? formatPublishedDate(article.publishedAt) : null,
    `${readMinutes} min read`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* The one full-bleed element on the page — a sibling before the
          max-w-[900px] <article>, not nested inside it, so the tint can
          span edge to edge while the header text inside it still holds to
          the 680px column. bg-primary/5: low enough opacity that body-text
          contrast (rendered on white further down the page) is untouched —
          this band never contains body copy, only the header. */}
      <div className="bg-primary/5">
        <div className="max-w-[680px] mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
          {/* 1. Eyebrow — site identity, since most arrivals are a shared link
              landing straight on this page with no other context. */}
          <div className="flex items-center gap-3">
            <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary">
              SPARC Showcase
            </span>
            <span className="px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm">
              {typeLabel}
            </span>
            {isOwner && (
              <Link
                href={`/promote/${article.slug}/edit`}
                className="ml-auto shrink-0 inline-flex items-center gap-1 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                Edit
              </Link>
            )}
          </div>

          {/* 2. Headline — 44px desktop, 1.15 line-height. */}
          <h1 className="mt-4 font-headline-lg text-on-background text-[32px] leading-[1.15] md:text-[44px]">
            {article.headline}
          </h1>

          {/* 3. Standfirst — 21px regular, secondary colour, 1.5 line-height:
              clearly larger than the 18px body, never the same weight/size. */}
          {article.standfirst && (
            <p className="mt-4 font-body-lg text-[21px] font-normal leading-[1.5] text-secondary">
              {article.standfirst}
            </p>
          )}

          {/* 4. Byline — 14px muted. text-body-sm IS 14px/20px/400 already, no
              arbitrary value needed. */}
          <p className="mt-4 font-body-sm text-body-sm text-secondary/80">{byline}</p>
        </div>
      </div>

      <article className="max-w-[900px] mx-auto px-margin-mobile md:px-margin-desktop pt-8 pb-12 md:pb-16">
        {/* Hero — BELOW the header band, not above it, and WIDER than the
            prose column (up to the full 900px), the standard editorial
            split of narrow text / wide image. Natural aspect ratio: no
            fixed box, no object-fit, no background panel — just the image
            at its own intrinsic ratio, shrunk to fit the column width and
            capped at 70vh tall so a portrait poster can't take over the
            screen. */}
        {hero && (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={hero} alt="" className="max-w-full max-h-[70vh] w-auto h-auto rounded-2xl" />
          </div>
        )}

        <div className="max-w-[680px] mx-auto">
          <div className={hero ? "mt-8" : ""}>{renderBody(article.articleBody)}</div>

          {/* Extra images get the SAME treatment as the hero — natural
              aspect ratio, capped to the content width and 70vh tall, no
              crop — just stacked with space between them instead of floating
              as bare, unframed <img> tags at their raw natural size. */}
          {extraImages.length > 0 && (
            <div className="mt-8 space-y-6">
              {extraImages.map((m) => (
                <div key={m.id} className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.url}
                    alt=""
                    className="max-w-full max-h-[70vh] w-auto h-auto rounded-2xl"
                  />
                </div>
              ))}
            </div>
          )}

          {/* A PDF/PPTX has no business trying to render as an <img> — it
              just breaks. Every "slides" media file is a labelled download
              link instead, filename plus size so it reads as a real
              attachment, not a mystery link. */}
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
                      <span className="text-secondary font-body-sm text-body-sm">
                        ({(m.sizeBytes / 1024 / 1024).toFixed(1)} MB)
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer card — the DOI link and who posted this, together, above
              the share row. Previously the DOI was a bare line loose in the
              body flow and there was no attribution to the person/lab that
              shared it at all. */}
          {(article.doi || article.owner?.name) && (
            <div className="mt-10 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 space-y-3">
              {article.doi && (
                <a
                  href={`https://doi.org/${article.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                >
                  Read the original paper
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                </a>
              )}
              {article.owner?.name && (
                <p className="font-body-sm text-body-sm text-secondary">
                  Posted by {article.owner.name}
                  {article.owner.affiliation && ` · ${article.owner.affiliation}`}
                </p>
              )}
            </div>
          )}

          <div className="mt-10 border-t border-outline-variant/30 pt-8">
            <ShareButtons url={articleUrl(article.slug)} title={article.headline} />
          </div>
        </div>
      </article>
    </>
  );
}
