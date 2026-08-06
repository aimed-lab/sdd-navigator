"use client";

// Shared Folder section — frontend/design/projects/STRUCTURE.md, detail
// workspace, "Shared Folder". ANY member may set or change the link — RLS
// ("Projects: member update") already permits any member to update the
// project row, and this is just one more field on it.
//
// URL VALIDATION IS SERVER-SIDE, not just this input's type="url": a raw
// user-supplied string rendered as an href is an XSS vector, and a
// javascript: URL is exactly what lib/server/projects.ts:setSharedFolder()
// rejects — server-side, so a raw PostgREST/curl caller can't write one in
// even with a valid session. This form's own light client-side hint
// (type="url") is a courtesy, not the rule.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSharedFolderAction } from "@/app/projects/[id]/actions";
import type { SharedFolder } from "@/lib/server/projects";

const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function relativeLabel(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const age = Math.abs(diffMs);
  if (age < MINUTE_MS) return "just now";
  if (age < HOUR_MS) return RELATIVE_TIME.format(Math.round(diffMs / MINUTE_MS), "minute");
  if (age < DAY_MS) return RELATIVE_TIME.format(Math.round(diffMs / HOUR_MS), "hour");
  if (age < WEEK_MS) return RELATIVE_TIME.format(Math.round(diffMs / DAY_MS), "day");
  return RELATIVE_TIME.format(Math.round(diffMs / WEEK_MS), "week");
}

export default function SharedFolderSection({
  projectId,
  sharedFolder,
}: {
  projectId: string;
  sharedFolder: SharedFolder | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(sharedFolder);
  const [editing, setEditing] = useState(!current);
  const [url, setUrl] = useState(current?.url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !url.trim()) return;
    setSaving(true);
    setError(null);

    const res = await setSharedFolderAction(projectId, url);
    if (res.ok) {
      setCurrent(res.shared_folder);
      setEditing(false);
      router.refresh();
    } else {
      setError(res.error);
    }
    setSaving(false);
  };

  return (
    <section className="mb-20">
      <h2 className="font-headline-md text-headline-md text-on-background mb-6">Shared Folder</h2>

      {!editing && current ? (
        <div className="inline-flex items-center gap-6 p-4 pr-6 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm hover:shadow-md transition-shadow group">
          <div className="w-12 h-12 bg-surface-container-low rounded-lg flex items-center justify-center text-primary group-hover:bg-primary/5 transition-colors shrink-0">
            <span
              className="material-symbols-outlined text-[28px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              folder_shared
            </span>
          </div>
          <div className="min-w-0">
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-body-md text-primary font-medium group-hover:underline flex items-center gap-1 truncate"
            >
              <span className="truncate">{current.url}</span>
              <span className="material-symbols-outlined text-[16px] shrink-0">open_in_new</span>
            </a>
            <div className="font-body-sm text-secondary mt-1 flex items-center gap-3 flex-wrap">
              {current.set_by_name
                ? `Added by ${current.set_by_name}, ${relativeLabel(current.set_at)}`
                : `Added ${relativeLabel(current.set_at)}`}
              <button
                type="button"
                onClick={() => {
                  setUrl(current.url);
                  setError(null);
                  setEditing(true);
                }}
                className="font-label-sm text-tertiary hover:text-primary transition-colors"
              >
                Change link
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-2xl"
        >
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link to your team's Box or Drive folder"
            aria-label="Shared folder link"
            className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {current && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="font-label-sm text-label-sm text-secondary hover:text-primary"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {error && (
        <p className="mt-3 font-body-sm text-body-sm text-error max-w-2xl" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
