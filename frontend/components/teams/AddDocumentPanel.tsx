"use client";

// "Share a document": a title, then a file or a link (or both). Reuses the
// community resource actions, so the same checks apply: http(s) links only,
// PNG / JPEG / WebP / GIF / PDF / PPTX files up to 50 MB, and in a team any
// member may add.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addCommunityResourceFileAction, createCommunityResourceAction } from "@/app/communities/actions";

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.pptx,.png,.jpg,.jpeg,.webp,.gif";
const MAX_BYTES = 50 * 1024 * 1024;

const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary";

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
  const [error, setError] = useState<string | null>(null);

  const pick = (list: FileList | null) => {
    setError(null);
    const f = list?.[0] ?? null;
    if (f && f.size > MAX_BYTES) {
      setError(`"${f.name}" is over 50 MB.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
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

    const made = await createCommunityResourceAction(teamId, slug, {
      title,
      resource_type: url.trim() && !file ? "link" : "other",
      url,
      description: "",
    });
    if (!made.ok) {
      setError(made.error);
      setBusy(false);
      return;
    }
    if (file) {
      const fd = new FormData();
      fd.set("communityId", teamId);
      fd.set("resourceId", made.id);
      fd.set("file", file);
      const up = await addCommunityResourceFileAction(fd);
      if (!up.ok) {
        setError(`Saved, but the file did not upload: ${up.error}`);
        setBusy(false);
        router.refresh();
        return;
      }
    }
    router.refresh();
    onClose();
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
          className="btn-outline px-4 py-2 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[18px]">attach_file</span>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => pick(e.target.files)} className="sr-only" />
        <span className="font-body-sm text-body-sm text-secondary">
          {file ? file.name : "PDF, PowerPoint or image, up to 50 MB."}
        </span>
      </div>
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
          {busy ? "Sharing…" : "Share with the team"}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
      </div>
    </form>
  );
}
