"use client";

// "Share a document": a title, then a file or a link (or both). A file goes
// straight from the browser to storage (see components/communities/
// resourceUpload.ts), so size is not limited by the server: up to 50 MB, PNG /
// JPEG / WebP / GIF / PDF / PPTX. It is all or nothing: the document is created
// only after its file arrived, and a failure says why and leaves nothing behind.
// In a team any member may add.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createCommunityResourceAction } from "@/app/communities/actions";
import { createResourceWithFile } from "@/components/communities/resourceUpload";
import { checkResourceFile } from "@/lib/server/communityHome/resourceFile";

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.pptx,.png,.jpg,.jpeg,.webp,.gif";

const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function AddDocumentPanel({
  teamId,
  slug,
  onClose,
}: {
  teamId: string;
  slug: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (list: FileList | null) => {
    setError(null);
    const f = list?.[0] ?? null;
    if (f) {
      const check = checkResourceFile(f);
      if (!check.ok) {
        setError(`"${f.name}": ${check.error}`);
        if (fileRef.current) fileRef.current.value = "";
        setFile(null);
        return;
      }
    }
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give it a title.");
    if (!url.trim() && !file) return setError("Add a link or choose a file.");
    setBusy(true);
    setError(null);
    setProgress(null);

    try {
      const input = {
        title,
        resource_type: url.trim() && !file ? "link" : "other",
        url,
        description: "",
      };
      const res = file
        ? await createResourceWithFile({ communityId: teamId, slug, input, file, onProgress: setProgress })
        : await createCommunityResourceAction(teamId, slug, input);
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        setProgress(null);
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      console.error("AddDocumentPanel submit failed", err);
      setError("Something went wrong. Nothing was saved. Please try again.");
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Title"
        className={INPUT}
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link (https://…), if it lives online"
        aria-label="Link"
        className={INPUT}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn-outline px-4 py-2 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">attach_file</span>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => pick(e.target.files)} className="sr-only" />
        <span className="font-body-sm text-body-sm text-secondary">
          {file ? file.name : "PDF, PowerPoint or image, up to 50 MB."}
        </span>
      </div>
      {busy && file && (
        <div role="status" aria-live="polite" className="flex flex-col gap-1">
          <div className="h-2 rounded-full bg-[#ece9df] overflow-hidden">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress ?? 5}%` }} />
          </div>
          <span className="font-body-sm text-body-sm text-secondary">
            {progress !== null && progress >= 100 ? "Saving…" : `Uploading… ${progress ?? 0}%`}
          </span>
        </div>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {busy ? (file ? "Uploading…" : "Sharing…") : "Share with the team"}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
      </div>
    </form>
  );
}
