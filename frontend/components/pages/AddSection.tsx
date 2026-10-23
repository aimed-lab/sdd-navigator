"use client";

// "+ Add section" at the end of a wiki page's notes, for anyone who can edit the
// page. A title and a text box (markdown is fine); the new section is marked as
// written by a person.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addNoteAction } from "@/app/pages/[slug]/actions";

export default function AddSection({ pageId, pageSlug }: { pageId: string; pageSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await addNoteAction(pageId, pageSlug, title, body);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setTitle("");
      setBody("");
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 self-start px-4 py-2 rounded-lg font-label-md text-label-md text-primary hover:bg-primary/5"
      >
        <span className="material-symbols-outlined text-base">add</span>
        Add section
      </button>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 max-w-3xl rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
      <label className="font-label-md text-label-md text-on-background" htmlFor="new-section-title">
        Section title
      </label>
      <input
        id="new-section-title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        disabled={busy}
        className="w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <label className="font-label-md text-label-md text-on-background" htmlFor="new-section-body">
        Text
      </label>
      <textarea
        id="new-section-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        disabled={busy}
        className="w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="font-label-md text-label-md text-secondary hover:text-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
