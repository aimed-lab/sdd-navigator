"use client";

// Submit-to-showcase form. Layout follows
// design/stitch/smartdrugdiscovery_submit_to_showcase_form, restyled in the
// shared design system.
//
// Only rendered for a signed-in user — app/promote/submit/page.tsx shows the
// sign-in gate instead. submitShowcaseAction re-checks server-side and RLS
// enforces ownership, so this gate is UX, not the enforcement.
//
// The image is OPTIONAL throughout: no file selected means image_url stays null
// and the gallery renders the text-only card style.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { submitShowcaseAction } from "@/app/promote/actions";
import { SHOWCASE_TYPES, SHOWCASE_TYPE_LABEL, type ShowcaseType } from "@/lib/showcaseTypes";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function SubmitShowcaseForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ShowcaseType>("case_study");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [authors, setAuthors] = useState("");
  const [link, setLink] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v) return;
    if (!tags.some((t) => t.toLowerCase() === v.toLowerCase())) setTags([...tags, v]);
    setTagDraft("");
  };

  const pickImage = (file: File | null) => {
    setError(null);
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      setError("Image must be a PNG, JPEG, WebP or GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be under 5 MB.");
      return;
    }
    setImage(file);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old); // don't leak the previous blob URL
      return URL.createObjectURL(file);
    });
  };

  const removeImage = () => {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }
    setSaving(true);
    setError(null);

    // FormData, not a plain object: a File can only reach a Server Action this way.
    const fd = new FormData();
    fd.set("type", type);
    fd.set("title", title);
    fd.set("description", description);
    fd.set("authors", authors);
    fd.set("link", link);
    fd.set("tags", JSON.stringify(tags));
    if (image) fd.set("image", image);

    const res = await submitShowcaseAction(fd);
    if (res.ok) {
      router.push("/promote");
      router.refresh();
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  const field =
    "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="glass-panel rounded-2xl p-6 space-y-5">
        <h2 className="font-headline-md text-lg text-on-background">What are you sharing?</h2>

        <div>
          <label htmlFor="type" className="block font-label-md text-label-md text-on-background mb-2">
            Type
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as ShowcaseType)}
            className={field}
          >
            {SHOWCASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SHOWCASE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="title" className="block font-label-md text-label-md text-on-background mb-2">
            Title
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Cutting hit-to-lead time with a shared assay core"
            className={field}
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block font-label-md text-label-md text-on-background mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you do, and why does it matter?"
            className={field}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label
              htmlFor="authors"
              className="block font-label-md text-label-md text-on-background mb-2"
            >
              Authors
            </label>
            <input
              id="authors"
              type="text"
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="Names, comma separated"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="link" className="block font-label-md text-label-md text-on-background mb-2">
              Link <span className="text-secondary font-body-sm">(optional)</span>
            </label>
            <input
              id="link"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className={field}
            />
          </div>
        </div>
      </section>

      {/* Optional image */}
      <section className="glass-panel rounded-2xl p-6">
        <h2 className="font-headline-md text-lg text-on-background">
          Figure <span className="font-body-md text-secondary">(optional)</span>
        </h2>
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          PNG, JPEG, WebP or GIF, up to 5 MB. Without one your entry renders as a
          clean text card — no placeholder image is invented.
        </p>

        {!preview ? (
          <label className="mt-4 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-outline-variant/50 rounded-xl py-10 cursor-pointer hover:bg-surface-container-low transition-all">
            <span className="material-symbols-outlined text-3xl text-primary">upload</span>
            <span className="font-label-md text-label-md text-on-background">
              Choose an image
            </span>
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED.join(",")}
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </label>
        ) : (
          <div className="mt-4">
            <div className="rounded-xl overflow-hidden border border-outline-variant/40 bg-surface-container-high">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Selected figure preview" className="w-full h-auto max-h-72 object-contain" />
            </div>
            <div className="flex items-center justify-between gap-3 mt-3">
              <span className="font-body-sm text-body-sm text-secondary truncate">
                {image?.name} · {(((image?.size ?? 0) / 1024 / 1024) || 0).toFixed(2)} MB
              </span>
              <button
                type="button"
                onClick={removeImage}
                className="inline-flex items-center gap-1 font-label-md text-label-md text-error hover:underline"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                Remove
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Tags */}
      <section className="glass-panel rounded-2xl p-6">
        <h2 className="font-headline-md text-lg text-on-background">Tags</h2>
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          Helps people find your entry.
        </p>
        <div className="flex gap-2 mt-4">
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // never submit the form from the tag field
                addTag();
              }
            }}
            placeholder="e.g. oncology"
            aria-label="Add a tag"
            className={field + " flex-1"}
          />
          <button
            type="button"
            onClick={addTag}
            className="btn-outline px-5 py-3 rounded-lg font-label-md text-label-md shrink-0"
          >
            Add
          </button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-2 pl-3 pr-2 py-1 rounded-full bg-primary/5 text-on-surface-variant font-body-sm text-body-sm"
              >
                {t}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                  aria-label={`Remove ${t}`}
                  className="text-secondary hover:text-error transition-colors"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link href="/promote" className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {saving ? "Submitting…" : "Submit to showcase"}
        </button>
      </div>
    </form>
  );
}
