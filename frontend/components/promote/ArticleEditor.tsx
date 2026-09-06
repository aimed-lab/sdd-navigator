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

import { useState } from "react";
import Link from "next/link";
import { setArticlePublishedAction, updateArticleDraftAction } from "@/app/promote/actions";
import MediaUploader from "@/components/promote/MediaUploader";
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
  authors: string;
};

/** Only relevant right after DOI generation (SubmitFlow) — the "Paper
 *  found" recap card. Absent when opening an existing entry to edit it, or
 *  when the entry was never DOI-sourced to begin with. */
export type ArticleEditorPaperInfo = {
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
  doneHref = "/promote",
}: {
  entry: ArticleEditorEntry;
  media: ShowcaseMedia[];
  paper?: ArticleEditorPaperInfo;
  /** Where "Done"/"Save & finish later" goes. Defaults to the gallery
   *  (submit-flow usage); the edit route points it back at the article. */
  doneHref?: string;
}) {
  const [entry, setEntry] = useState(initialEntry);
  const [type, setType] = useState<ShowcaseType>(initialEntry.type);
  const [headline, setHeadline] = useState(initialEntry.headline);
  const [standfirst, setStandfirst] = useState(initialEntry.standfirst);
  const [articleBody, setArticleBody] = useState(initialEntry.articleBody);
  const [authors, setAuthors] = useState(initialEntry.authors);

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
    const res = await setArticlePublishedAction(entry.id, entry.slug, nextPublished);
    setSaving(false);
    if (res.ok) setEntry((e) => ({ ...e, published: nextPublished }));
    else setSaveError(res.error);
  };

  return (
    <div className="space-y-6">
      {paper && (
        <section className="glass-panel rounded-2xl p-6">
          <p className="font-label-sm text-label-sm text-secondary uppercase mb-1">Paper found</p>
          <h3 className="font-headline-md text-lg text-on-background">{paper.title}</h3>
          <p className="mt-1 font-body-sm text-body-sm text-secondary">
            {paper.authors.slice(0, 4).join(", ")}
            {paper.authors.length > 4 && " et al."}
            {paper.journal && ` · ${paper.journal}`}
            {paper.publishedDate && ` · ${paper.publishedDate}`}
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

        <div>
          <label className="block font-label-sm text-label-sm text-secondary mb-1">Headline</label>
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
          <label className="block font-label-sm text-label-sm text-secondary mb-1">Authors</label>
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
  );
}
