"use client";

// The Media section: attach/remove images and slide decks. Two callers:
//   - components/promote/SubmitFlow.tsx's manual form — there is NO row yet
//     when this mounts (a row is created lazily, on first input anywhere in
//     the form). `ensureShowcaseId` is how this gets one on demand: it's
//     called only when a file is actually picked, not on mount, so opening
//     the submit page never creates a draft on its own.
//   - components/promote/ArticleEditor.tsx — editing an entry that already
//     exists (paper path post-generation, or the edit route); its
//     `ensureShowcaseId` is trivial, just resolving to that id.
//
// The lead sentence in the helper text is category-specific (a poster
// prompts differently than a tool screenshot); the accepted types and size
// limit after it never change, since those are the same for every category.

import { useEffect, useRef, useState } from "react";
import { addShowcaseMediaAction, removeShowcaseMediaAction } from "@/app/promote/actions";
import type { ShowcaseMedia, ShowcaseType } from "@/lib/showcaseTypes";

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MEDIA_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

const MEDIA_HINT: Record<ShowcaseType, string> = {
  paper: "A figure, chart, or a copy of the poster or slides, if you have one.",
  talk: "Upload your slides or a photo from the session.",
  poster: "Upload the poster as an image or PDF.",
  award: "A photo of the award, plaque, or moment.",
  tool: "Screenshots or a demo.",
  other: "Anything that helps show what this is.",
};

export default function MediaUploader({
  ensureShowcaseId,
  type,
  initialMedia,
}: {
  /** Resolves to the showcase_id to upload against, creating the draft row
   *  first if one doesn't exist yet. Called lazily — only when a file is
   *  actually picked — and memoized locally (via showcaseIdRef below) so a
   *  multi-file selection or several uploads in a row only ever resolves
   *  once. Throws if the row can't be created/found, which uploadFile below
   *  turns into a normal mediaError rather than an unhandled rejection. */
  ensureShowcaseId: () => Promise<string>;
  /** Drives only the helper text's lead sentence — reactive, so changing
   *  the Type dropdown in ArticleEditor (or SubmitFlow's manual form)
   *  updates the hint immediately. */
  type: ShowcaseType;
  initialMedia: ShowcaseMedia[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const showcaseIdRef = useRef<string | null>(null);
  const [media, setMedia] = useState<ShowcaseMedia[]>(initialMedia);
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const resolveShowcaseId = async (): Promise<string> => {
    if (showcaseIdRef.current) return showcaseIdRef.current;
    const id = await ensureShowcaseId();
    showcaseIdRef.current = id;
    return id;
  };

  // If there's already attached media, a row obviously already exists —
  // resolve it up front so Remove works on one of THESE before the user has
  // uploaded anything new this session. Harmless to call eagerly here
  // specifically because it only ever runs when initialMedia is non-empty,
  // and BOTH callers only pass a non-empty initialMedia for an entry that
  // already exists (SubmitFlow's fresh form always passes []) — so this can
  // never be what creates a draft on page load.
  useEffect(() => {
    if (initialMedia.length > 0) {
      resolveShowcaseId().catch(() => {
        // A failed resolve here just means Remove won't work until a
        // successful upload resolves it instead — not worth an error
        // banner before the user has done anything.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadFile = async (file: File) => {
    setMediaError(null);
    if (file.size > MAX_MEDIA_BYTES) {
      setMediaError(`"${file.name}" is over 50 MB.`);
      return;
    }

    setUploading(true);
    try {
      const showcaseId = await resolveShowcaseId();
      const fd = new FormData();
      fd.set("showcaseId", showcaseId);
      fd.set("file", file);
      const res = await addShowcaseMediaAction(fd);
      if (res.ok) setMedia((m) => [...m, res.media]);
      else setMediaError(res.error);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : "Couldn't attach that file. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) await uploadFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeMedia = async (mediaId: string) => {
    // A row that has never been resolved has never uploaded anything
    // either — `media` would be empty and this button unreachable — but
    // guard anyway rather than calling the action with a null id.
    const showcaseId = showcaseIdRef.current;
    if (!showcaseId) return;

    setMediaError(null);
    const res = await removeShowcaseMediaAction(showcaseId, mediaId);
    if (res.ok) setMedia((m) => m.filter((x) => x.id !== mediaId));
    else setMediaError(res.error);
  };

  return (
    <section className="glass-panel rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="font-headline-md text-lg text-on-background">Media</h2>
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          {MEDIA_HINT[type]} PNG, JPEG, WebP, GIF, PDF or PPTX, up to 50 MB
          each. Add as many as you like.
        </p>
      </div>

      {media.length > 0 && (
        <ul className="space-y-2">
          {media.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-primary text-base shrink-0">
                  {m.kind === "image" ? "image" : "slideshow"}
                </span>
                <span className="font-body-sm text-body-sm text-on-background truncate">
                  {m.filename}
                </span>
                <span className="font-label-sm text-label-sm text-secondary shrink-0">
                  {(m.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeMedia(m.id)}
                className="shrink-0 font-label-sm text-label-sm text-error hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {mediaError && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {mediaError}
        </p>
      )}

      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-outline-variant/50 rounded-xl py-8 cursor-pointer hover:bg-surface-container-low transition-all">
        <span className="material-symbols-outlined text-2xl text-primary">
          {uploading ? "hourglass_top" : "upload"}
        </span>
        <span className="font-label-md text-label-md text-on-background">
          {uploading ? "Uploading…" : "Add a file"}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          disabled={uploading}
          onChange={(e) => uploadFiles(e.target.files)}
          className="sr-only"
        />
      </label>
    </section>
  );
}
