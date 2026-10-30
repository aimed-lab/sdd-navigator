"use client";

// "Code (GitHub)" on the Files tab, next to the shared folder link. Any member
// can add, change or clear it (the same rule as the folder link). Only
// https://github.com/... links are accepted, here and in the database.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setGithubUrlAction } from "@/app/projects/[id]/actions";

export default function GithubLinkSection({ projectId, githubUrl }: { projectId: string; githubUrl: string | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState(githubUrl);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(githubUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await setGithubUrlAction(projectId, value);
    setSaving(false);
    if (res.ok) {
      setCurrent(res.github_url);
      setUrl(res.github_url ?? "");
      setEditing(false);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <section className="mb-20">
      <h2 className="font-headline-md text-headline-md text-on-background mb-6">Code (GitHub)</h2>

      {!editing && current ? (
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={current}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-body-md text-body-md text-primary font-medium hover:underline break-all"
          >
            <span className="material-symbols-outlined text-[20px]">code</span>
            {current.replace("https://", "")}
            <span className="material-symbols-outlined text-[16px] shrink-0">open_in_new</span>
          </a>
          <button
            type="button"
            onClick={() => {
              setUrl(current);
              setEditing(true);
            }}
            className="font-label-sm text-label-sm text-tertiary hover:text-primary"
          >
            Change link
          </button>
        </div>
      ) : editing || !current ? (
        !editing ? (
          <div>
            <p className="font-body-md text-body-md text-secondary mb-3">
              No code link yet. Add your team&apos;s GitHub repository so everyone can find it.
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-outline px-5 py-2.5 rounded-lg font-label-md text-label-md"
            >
              Add GitHub link
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(url);
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-2xl"
          >
            <input
              type="url"
              required={!current}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/your-team/your-repo"
              aria-label="GitHub link"
              className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex items-center gap-3 shrink-0">
              <button type="submit" disabled={saving} className="btn-outline px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
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
              {current && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save("")}
                  className="font-label-sm text-label-sm text-secondary hover:text-error"
                >
                  Remove link
                </button>
              )}
            </div>
          </form>
        )
      ) : null}

      {error && (
        <p className="mt-3 font-body-sm text-body-sm text-error max-w-2xl" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
