"use client";

// The shared article editor — headline, standfirst, body, authors, type, and
// the Media section. Used two places, against the SAME row either way:
//   - components/promote/SubmitFlow.tsx, right after a draft is created
//     (DOI-generated or written by hand)
//   - app/promote/[slug]/edit/page.tsx, reopening an existing entry
// so there is exactly one editing UI, not a submit-time one and a separate
// edit-time one that could drift apart.
//
// Publish/unpublish never navigates away on its own — it just flips
// `entry.published` in place and the UI updates (the "Published" pill, the
// Publish/Unpublish button, the "View published article" link). That's what
// lets the SAME toggle serve both "publish for the first time" (submit flow)
// and "take this back down to a draft" (edit route) with no special-casing
// between them.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setArticlePublishedAction, updateArticleDraftAction } from "@/app/promote/actions";
import MediaUploader from "@/components/promote/MediaUploader";
import ShareButtons from "@/components/promote/ShareButtons";
import { articleUrl, withArticleLink } from "@/lib/articleFormat";
import {
  SHOWCASE_TYPES,
  SHOWCASE_TYPE_LABEL,
  type ShowcaseMedia,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

const fieldClass =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

export type ArticleEditorEntry = {
  id: string;
  slug: string;
  published: boolean;
  type: ShowcaseType;
  headline: string;
  standfirst: string;
  articleBody: string;
  linkedinPost: string;
  authors: string;
  /** Null = attached to no community (the default). See
   *  database/migrations/2026-09-13_promote_showcase_community.sql. */
  communityId: string | null;
};

/** Only relevant right after generation (SubmitFlow) — the "Paper found" /
 *  "Repository found" recap card. Absent when opening an existing entry to
 *  edit it, or when the entry was never generated from a DOI or GitHub URL
 *  to begin with. `kind` picks the card's label and byline shape — a repo
 *  has no authors/journal, so the byline is just the pushed date, not an
 *  empty "· date" left over from a paper-shaped line with nothing before
 *  the separator. Defaults to "paper" so every existing call site (which
 *  predates this field) keeps rendering exactly as it did. */
export type ArticleEditorPaperInfo = {
  kind?: "paper" | "tool";
  title: string;
  authors: string[];
  sourceUrl: string;
  journal: string | null;
  publishedDate: string | null;
} | null;

export default function ArticleEditor({
  entry: initialEntry,
  media: initialMedia,
  paper = null,
  communities = [],
  doneHref = "/promote",
}: {
  entry: ArticleEditorEntry;
  media: ShowcaseMedia[];
  paper?: ArticleEditorPaperInfo;
  /** Communities the signed-in author is an ACTIVE member of — the ONLY
   *  choices the picker below may offer (see
   *  lib/server/communities.ts:listMyActiveCommunities, which is what both
   *  callers, SubmitFlow.tsx and app/promote/[slug]/edit/page.tsx, fetch
   *  this from). Empty for a member of nothing, which is what makes the
   *  picker not render at all rather than show as a confusing empty
   *  dropdown — see the "None" render below. */
  communities?: { id: string; slug: string; name: string }[];
  /** Where "Done"/"Save & finish later" goes. Defaults to the gallery
   *  (submit-flow usage); the edit route points it back at the article. */
  doneHref?: string;
}) {
  const [entry, setEntry] = useState(initialEntry);
  const router = useRouter();
  const pathname = usePathname();
  const [type, setType] = useState<ShowcaseType>(initialEntry.type);
  const [headline, setHeadline] = useState(initialEntry.headline);
  const [standfirst, setStandfirst] = useState(initialEntry.standfirst);
  const [articleBody, setArticleBody] = useState(initialEntry.articleBody);
  const [communityId, setCommunityId] = useState<string | null>(initialEntry.communityId);
  // Resolved up front — the placeholder never reaches the screen, even for
  // a row saved before this resolution existed (see withArticleLink's own
  // comment). The slug (and so the URL) exists from the moment the row
  // does, published or not, so there's never a "no link yet" case here.
  const [linkedinPost, setLinkedinPost] = useState(() =>
    withArticleLink(initialEntry.linkedinPost, articleUrl(initialEntry.slug))
  );
  const [authors, setAuthors] = useState(initialEntry.authors);

  // Auto-grows the post textarea to its content instead of letting the
  // primary output of this page scroll inside a ~230px box with the ask,
  // the link and the hashtags hidden below the fold.
  const postRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = postRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [linkedinPost]);

  // The LinkedIn post panel sticks down the left column ON A WIDE SCREEN
  // ONLY WHILE IT FITS the viewport (see the panel's className below) — a
  // sticky element taller than the viewport pins its top edge in place with
  // no way to scroll to its own bottom, which would trap the share buttons
  // below the fold. STICKY_TOP_PX must match the `lg:top-24` on the panel
  // itself (6rem at the default 16px root). Re-measured on every resize AND
  // whenever the panel's own content changes height (typing into the post
  // textarea above resizes this same box, via the ResizeObserver rather than
  // a linkedinPost dependency, so it also catches a font/zoom change).
  const STICKY_TOP_PX = 96;
  const leftColRef = useRef<HTMLDivElement>(null);
  const [canStick, setCanStick] = useState(true);
  useEffect(() => {
    const el = leftColRef.current;
    if (!el) return;
    const check = () => setCanStick(el.offsetHeight <= window.innerHeight - STICKY_TOP_PX);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const saveEdits = async () => {
    setSaving(true);
    setSaveError(null);
    const res = await updateArticleDraftAction(entry.id, {
      type,
      headline,
      standfirst,
      articleBody,
      linkedinPost,
      communityId,
      authors,
    });
    setSaving(false);
    if (res.ok) setDirty(false);
    else setSaveError(res.error);
  };

  const canPublish = entry.published || (headline.trim() !== "" && articleBody.trim() !== "");

  const togglePublished = async () => {
    const nextPublished = !entry.published;
    if (nextPublished && !canPublish) {
      setSaveError("Add a headline and body before publishing.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const oldSlug = entry.slug;
    const res = await setArticlePublishedAction(entry.id, oldSlug, nextPublished);
    setSaving(false);
    if (res.ok) {
      setEntry((e) => ({ ...e, published: nextPublished, slug: res.slug }));
      // A FIRST publish may have just regenerated a placeholder-derived
      // slug (setArticlePublished's own comment) — if this editor is
      // sitting on /promote/<oldSlug>/edit (reopened via that route, not
      // the submit-flow hand-off, which stays on /promote/submit), that
      // URL now points at a slug that no longer exists. Swap it for the
      // real one so a refresh — or "View" / the share link right below —
      // doesn't 404.
      if (res.slug !== oldSlug && pathname === `/promote/${oldSlug}/edit`) {
        router.replace(`/promote/${res.slug}/edit`);
      }
    } else {
      setSaveError(res.error);
    }
  };

  return (
    // TWO INDEPENDENT COLUMNS ON A WIDE SCREEN, each its own stacking
    // container (`space-y-6`) — NOT items placed into shared implicit grid
    // rows. A shared-row layout (tried first) made the right column's rows
    // inherit height from whatever the row-spanning left column needed,
    // pushing the Article panel hundreds of pixels down below empty space.
    // With exactly two grid children — one wrapper div per column — there
    // are no other rows for either column's height to leak into: the right
    // column's items simply follow each other immediately, and both columns
    // start at the grid's single row, i.e. the same y.
    //
    // Left column ("Paper found" + the LinkedIn post) is ~45% width
    // (`0.45fr`/`0.55fr` — real fr units, so `lg:gap-8` is subtracted before
    // the split, not fought over with a plain percentage). 45% is sized to
    // let the post wrap at roughly LinkedIn's own ~550px feed-column width,
    // not the ~35-characters-per-line a too-narrow preview column produces.
    //
    // Grouping "Paper found" with the post (not with the Article panel) is
    // what keeps the narrow-screen stack in the right order without any
    // reordering trick: below `lg` this is just two stacked <div>s in
    // source order, so it reads paper info, then the post, then the
    // article/media/publish controls — the same order the page read before
    // there were two columns, since paper info and the post are the two
    // things that came out of the SAME generation step.
    //
    // `lg:items-start`: a column would otherwise stretch to match the
    // taller one (the default `stretch`) — its own content should decide
    // its height, which is also what lets `position: sticky` (on the left
    // column below) do anything at all.
    //
    // No shared background wraps the two columns — each section keeps its
    // own glass-panel card, and the page's own background (not a per-column
    // box) shows in the gutter and past whichever column ends first. Two
    // columns of very different height still read as one page this way,
    // not two stranded, mismatched-height strips.
    <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[0.45fr_0.55fr] lg:gap-8 lg:items-start">
      <div
        ref={leftColRef}
        className={`space-y-6 ${canStick ? "lg:sticky lg:top-24" : ""}`}
      >
        {paper && (
          <section className="glass-panel rounded-2xl p-6">
            <p className="font-label-sm text-label-sm text-secondary uppercase mb-1">
              {paper.kind === "tool" ? "Repository found" : "Paper found"}
            </p>
            <h3 className="font-headline-md text-lg text-on-background">{paper.title}</h3>
            <p className="mt-1 font-body-sm text-body-sm text-secondary">
              {[
                paper.authors.length
                  ? paper.authors.slice(0, 4).join(", ") + (paper.authors.length > 4 ? " et al." : "")
                  : null,
                paper.journal,
                paper.publishedDate,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <a
              href={paper.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
            >
              View the source
              <span className="material-symbols-outlined text-base">open_in_new</span>
            </a>
          </section>
        )}

        <section className="glass-panel rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="font-headline-md text-lg text-on-background">LinkedIn post</h2>
            <p className="mt-1 font-body-sm text-body-sm text-secondary">
              This is what you actually share — the article below is the page it
              links to, not the other way around.
            </p>
          </div>

          {/* Sans-serif, normal reading size, and styled like the post it
              will actually render as — LinkedIn renders in its own
              proportional font, so previewing this in a form field's
              monospace misrepresents the line breaks and rhythm the post
              actually depends on. No fixed rows/height: it grows with its
              content (see the postRef effect above) rather than scrolling a
              box that hides the ask, the link and the hashtags below the
              fold. */}
          <textarea
            ref={postRef}
            rows={1}
            value={linkedinPost}
            onChange={(e) => {
              setLinkedinPost(e.target.value);
              setDirty(true);
            }}
            placeholder="Hook, contrast, a few concrete specifics, an ask…"
            className="w-full resize-none overflow-hidden bg-surface-container-lowest border border-outline-variant/40 rounded-xl px-5 py-4 font-body-md text-body-md leading-relaxed text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 whitespace-pre-wrap"
          />

          <ShareButtons
            url={articleUrl(entry.slug)}
            title={headline}
            linkedinPost={linkedinPost}
          />
        </section>
      </div>

      <div className="space-y-6">
        <section className="glass-panel rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-headline-md text-lg text-on-background">Article</h2>
            <span
              className={
                "px-3 py-1 rounded-full font-label-sm text-label-sm " +
                (entry.published
                  ? "bg-primary/10 text-primary"
                  : "bg-surface-container-low text-secondary")
              }
            >
              {entry.published ? "Published" : "Draft"}
            </span>
          </div>

          <div>
            <label className="block font-label-sm text-label-sm text-secondary mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as ShowcaseType);
                setDirty(true);
              }}
              className={fieldClass}
            >
              {SHOWCASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SHOWCASE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Optional, defaults to none — and simply doesn't render for an
              author who belongs to no community, rather than showing an
              empty/single-disabled-option dropdown with nothing useful to
              pick. `communities` here is already scoped to ACTIVE membership
              only (see the prop's own comment) — there's no further
              filtering to do at render time. */}
          {communities.length > 0 && (
            <div>
              <label className="block font-label-sm text-label-sm text-secondary mb-1">
                Community
              </label>
              <select
                value={communityId ?? ""}
                onChange={(e) => {
                  setCommunityId(e.target.value || null);
                  setDirty(true);
                }}
                className={fieldClass}
              >
                <option value="">None</option>
                {communities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 font-label-sm text-label-sm text-secondary">
                Optional — shows this article in that community&apos;s own Showcase
                section too.
              </p>
            </div>
          )}

          <div>
            <label className="block font-label-sm text-label-sm text-secondary mb-1">
              Headline
            </label>
            <input
              value={headline}
              onChange={(e) => {
                setHeadline(e.target.value);
                setDirty(true);
              }}
              className={fieldClass + " font-headline-md text-lg"}
            />
          </div>

          <div>
            <label className="block font-label-sm text-label-sm text-secondary mb-1">
              Standfirst
            </label>
            <textarea
              rows={2}
              value={standfirst}
              onChange={(e) => {
                setStandfirst(e.target.value);
                setDirty(true);
              }}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block font-label-sm text-label-sm text-secondary mb-1">
              Authors
            </label>
            <input
              value={authors}
              onChange={(e) => {
                setAuthors(e.target.value);
                setDirty(true);
              }}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block font-label-sm text-label-sm text-secondary mb-1">
              Article body
            </label>
            <textarea
              rows={14}
              value={articleBody}
              onChange={(e) => {
                setArticleBody(e.target.value);
                setDirty(true);
              }}
              className={fieldClass + " whitespace-pre-wrap"}
            />
            <p className="mt-1 font-label-sm text-label-sm text-secondary">
              Lines starting with &quot;## &quot; become section headings on the
              published page.
            </p>
          </div>

          {saveError && (
            <p className="font-body-sm text-body-sm text-error" role="alert">
              {saveError}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveEdits}
              disabled={saving || !dirty}
              className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        <MediaUploader
          ensureShowcaseId={async () => entry.id}
          type={type}
          initialMedia={initialMedia}
        />

        <div className="flex items-center justify-end gap-3">
          <Link href={doneHref} className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
            {entry.published ? "Done" : "Save & finish later"}
          </Link>
          {entry.published && (
            <Link
              href={`/promote/${entry.slug}`}
              className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              View published article
            </Link>
          )}
          <button
            type="button"
            onClick={togglePublished}
            disabled={saving || (!entry.published && (dirty || !canPublish))}
            title={
              !entry.published && dirty
                ? "Save your changes first"
                : !entry.published && !canPublish
                  ? "Add a headline and body before publishing"
                  : undefined
            }
            className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {saving
              ? entry.published
                ? "Unpublishing…"
                : "Publishing…"
              : entry.published
                ? "Unpublish"
                : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
