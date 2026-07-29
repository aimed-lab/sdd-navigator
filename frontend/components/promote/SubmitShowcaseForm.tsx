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

  // DOI/PMID autofill. Same "only fill a blank field" guard as the ORCID
  // import in OnboardingForm.tsx (components/profile/OnboardingForm.tsx,
  // runImport) — a value the researcher already typed is never touched, only
  // an empty field gets filled.
  const [lookupId, setLookupId] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookedUpAbstract, setLookedUpAbstract] = useState<string | null>(null);
  const [filledFields, setFilledFields] = useState<string[]>([]);

  const runLookup = async () => {
    const id = lookupId.trim();
    if (!id || looking) return;

    setLookupError(null);
    setLookedUpAbstract(null);
    setFilledFields([]);

    // Cheap client-side shape check before spending a round trip: a PMID is
    // digits-only, a DOI always has a "/" (matches isPmid/isDoi in
    // lib/server/promote/fetchPaper.ts). Anything else can't resolve.
    const looksLikeId = /^\d+$/.test(id) || id.includes("/") || /^https?:\/\//i.test(id);
    if (!looksLikeId) {
      setLookupError("That doesn't look like a DOI or PubMed ID.");
      return;
    }

    setLooking(true);
    try {
      const res = await fetch("/api/promote/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: id }),
      });
      const json = await res.json();

      if (!res.ok) {
        setLookupError(json?.error ?? "Couldn't look that up. Please try again.");
        return;
      }

      const filled: string[] = [];
      if (json.title && !title.trim()) {
        setTitle(json.title);
        filled.push("Title");
      }
      if (Array.isArray(json.authors) && json.authors.length > 0 && !authors.trim()) {
        setAuthors(json.authors.join(", "));
        filled.push("Authors");
      }
      if (json.sourceUrl && !link.trim()) {
        setLink(json.sourceUrl);
        filled.push("Link");
      }
      setFilledFields(filled);
      // Description is deliberately NOT autofilled — an abstract answers "what
      // did they find", the form asks "what did you do, and why does it
      // matter", and those are different pieces of writing. Offered as an
      // optional insert instead, below.
      if (typeof json.abstract === "string" && json.abstract.trim()) {
        setLookedUpAbstract(json.abstract);
      }
    } catch {
      setLookupError("Couldn't reach the lookup service. Please try again.");
    } finally {
      setLooking(false);
    }
  };

  const insertAbstract = () => {
    if (!lookedUpAbstract) return;
    setDescription((prev) => (prev.trim() ? prev : lookedUpAbstract));
  };

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
      <section className="glass-panel rounded-2xl p-6 space-y-3">
        <label htmlFor="lookup" className="block font-label-md text-label-md text-on-background mb-2">
          DOI or PubMed ID <span className="text-secondary font-body-sm">(optional)</span>
        </label>
        <p className="-mt-1 font-body-sm text-body-sm text-secondary">
          Paste a DOI or PubMed ID to fill this in automatically. Works for any
          type here, not just Paper — a case study can have a DOI too.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="lookup"
            type="text"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup();
              }
            }}
            placeholder="10.1126/science.1225829 or a PubMed ID"
            className={field + " flex-1"}
          />
          <button
            type="button"
            onClick={runLookup}
            disabled={looking || !lookupId.trim()}
            className="btn-outline shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {looking ? (
              <>
                <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Looking up…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">search</span>
                Fill in automatically
              </>
            )}
          </button>
        </div>

        {lookupError && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {lookupError}
          </p>
        )}

        {filledFields.length > 0 && !lookupError && (
          <p className="font-body-sm text-body-sm text-primary">
            Filled in: {filledFields.join(", ")}. Everything stays editable — change
            anything below.
          </p>
        )}

        {lookedUpAbstract && (
          <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
            <p className="font-label-sm text-label-sm text-secondary uppercase mb-1">
              Abstract found
            </p>
            <p className="font-body-sm text-body-sm text-secondary line-clamp-4">
              {lookedUpAbstract}
            </p>
            <p className="mt-2 font-body-sm text-body-sm text-secondary">
              This is what the paper found, not what you did with it — the
              Description below asks the latter. Insert it only if you want a
              starting point to rewrite from.
            </p>
            <button
              type="button"
              onClick={insertAbstract}
              disabled={!!description.trim()}
              className="mt-2 font-label-md text-label-md text-primary hover:underline underline-offset-4 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
            >
              {description.trim() ? "Description already has text" : "Insert into Description"}
            </button>
          </div>
        )}
      </section>

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
