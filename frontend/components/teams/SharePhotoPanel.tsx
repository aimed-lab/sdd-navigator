"use client";

// "Share a photo": pick a photo from the gallery or files, resize it in the
// browser, then hand it to the phone's share sheet. Browsers that cannot share
// files get a download button and links to the sites. The photo goes nowhere
// else unless the member ticks the box, which uses the same shared-documents
// upload as "Share a document".

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addCommunityResourceFileAction, createCommunityResourceAction } from "@/app/communities/actions";
import { FACEBOOK_URL, PHOTO_MAX_SIDE, fitWithin, linkedInUrl, photoCaption, shareRoute, xUrl } from "@/lib/server/teams/photoShare";

const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";
const BTN = "btn-outline px-4 py-2 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5";

async function resize(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  if (!blob) throw new Error("no blob");
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

export default function SharePhotoPanel({
  teamId,
  slug,
  name,
  description,
}: {
  teamId: string;
  slug: string;
  name: string;
  description: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState(() => photoCaption(name, description));
  const [addDoc, setAddDoc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const choose = async (list: FileList | null) => {
    const f = list?.[0];
    setError(null);
    setNote(null);
    if (!f) return;
    setBusy(true);
    try {
      setPhoto(await resize(f));
    } catch {
      setPhoto(null);
      setError("That file could not be read as a photo.");
    }
    setBusy(false);
  };

  const route = shareRoute(typeof navigator === "undefined" ? undefined : navigator, photo);

  // Optional: reuse the "Share a document" upload. A failure never blocks sharing.
  const saveToDocuments = async (): Promise<void> => {
    if (!addDoc || !photo) return;
    const made = await createCommunityResourceAction(teamId, slug, {
      title: caption.trim().slice(0, 80) || photo.name,
      resource_type: "other",
      url: "",
      description: "",
    });
    if (!made.ok) return setNote(`Not added to shared documents: ${made.error}`);
    const fd = new FormData();
    fd.set("communityId", teamId);
    fd.set("resourceId", made.id);
    fd.set("file", photo);
    const up = await addCommunityResourceFileAction(fd);
    if (!up.ok) return setNote(`Not added to shared documents: ${up.error}`);
    router.refresh();
  };

  const share = async () => {
    if (!photo || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    await saveToDocuments();
    try {
      await navigator.share({ files: [photo], text: caption, title: name });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError("Sharing did not work. Try again.");
    }
    setBusy(false);
  };

  const download = () => {
    if (!photo || !preview) return;
    const a = document.createElement("a");
    a.href = preview;
    a.download = photo.name;
    a.click();
    if (addDoc) {
      setBusy(true);
      void saveToDocuments().finally(() => setBusy(false));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the caption and copy it by hand.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
          {photo ? "Choose a different photo" : "Upload a photo"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={(e) => choose(e.target.files)} className="sr-only" />
      </div>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Your photo" className="max-h-72 w-auto max-w-full rounded-xl border border-[#e8e4da] object-contain self-start" />
      )}

      <label className="flex flex-col gap-1.5">
        <span className="font-label-md text-label-md text-on-background">Caption</span>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className={INPUT} />
      </label>

      <label className="flex items-start gap-2 font-body-sm text-body-sm text-on-background">
        <input type="checkbox" checked={addDoc} onChange={(e) => setAddDoc(e.target.checked)} className="mt-1" />
        Also add this photo to the team&apos;s shared documents
      </label>

      {photo && route === "native" && (
        <div>
          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {busy ? "Sharing…" : "Share"}
          </button>
        </div>
      )}

      {photo && (
        <div className="flex flex-col gap-2">
          <p className="font-label-md text-label-md text-on-background">Or post it yourself:</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={download} className={BTN}>Download photo</button>
            <button type="button" onClick={copy} className={BTN}>{copied ? "Copied" : "Copy caption"}</button>
            <a href={linkedInUrl(caption)} target="_blank" rel="noopener noreferrer" className={BTN}>LinkedIn</a>
            <a href={xUrl(caption)} target="_blank" rel="noopener noreferrer" className={BTN}>X</a>
            <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className={BTN}>Facebook</a>
          </div>
          <p className="font-body-sm text-body-sm text-secondary">Download the photo, then attach it to your post.</p>
        </div>
      )}

      {note && <p className="font-body-sm text-body-sm text-secondary" role="status">{note}</p>}
      {error && <p className="font-body-sm text-body-sm text-error" role="alert">{error}</p>}
    </div>
  );
}
