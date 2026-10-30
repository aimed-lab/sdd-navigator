"use client";

// "New wiki page" inside a project: a title box, then the page is researched
// from that title (about a minute) and opened. With `parentPageId` it makes a
// sub-page under that page. The new page is visible to every project member.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProjectWikiPageAction } from "@/app/projects/[id]/actions";

export default function NewProjectWikiPage({
  projectId,
  parentPageId = null,
  variant = "primary",
}: {
  projectId: string;
  parentPageId?: string | null;
  /** primary: the tab's main button; text: a small "Add sub-page" link. */
  variant?: "primary" | "text";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createProjectWikiPageAction(projectId, title, parentPageId);
    if (res.ok) {
      router.push(`/pages/${res.slug}`);
      router.refresh();
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  if (!open) {
    return variant === "primary" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
        New wiki page
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4"
      >
        Add sub-page
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-xl rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 flex flex-col gap-3"
    >
      <label className="font-label-md text-label-md text-on-background" htmlFor={`wiki-title-${parentPageId ?? "root"}`}>
        {parentPageId ? "Sub-page title" : "What is the page about?"}
      </label>
      <input
        id={`wiki-title-${parentPageId ?? "root"}`}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
        maxLength={120}
        placeholder="e.g. PHGDH inhibitors in Alzheimer's disease"
        className="w-full bg-white border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary/60 focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {busy && (
        <p className="font-body-sm text-body-sm text-secondary" role="status">
          Researching this topic and writing the page. This takes about a minute; please stay on this page.
        </p>
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
          className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create wiki page"}
        </button>
        {!busy && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="font-label-md text-label-md text-secondary hover:text-primary"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
