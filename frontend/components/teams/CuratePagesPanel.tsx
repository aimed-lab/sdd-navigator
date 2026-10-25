"use client";

// "Curate wiki pages": search your own wiki pages and public ones, and add them
// to the team. Adding does not copy or change the page; it lets the team's
// members read it. For a page only you can read, the row says so before you add.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addTeamPageAction, searchTeamPagesAction } from "@/app/teams/actions";
import type { PageChoice } from "@/lib/server/teams/teams";

export default function CuratePagesPanel({
  teamId,
  slug,
  onClose,
}: {
  teamId: string;
  slug: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PageChoice[] | null>(null);
  const [added, setAdded] = useState<Record<string, PageChoice>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const res = await searchTeamPagesAction(teamId, query);
      if (!live) return;
      if (res.ok) {
        setRows(res.pages);
        setError(null);
      } else setError(res.error);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [teamId, query]);

  const add = async (p: PageChoice) => {
    setBusyId(p.id);
    setError(null);
    const res = await addTeamPageAction(teamId, slug, p.id);
    setBusyId(null);
    if (!res.ok) return setError(res.error);
    setAdded((a) => ({ ...a, [p.id]: { ...p, note: res.switchedToTeam ? "This page is now visible to your team." : null } }));
    router.refresh();
  };

  const visible = (rows ?? []).filter((p) => !added[p.id]);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your pages and public pages"
        aria-label="Search wiki pages"
        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />

      {Object.values(added).map((p) => (
        <p key={p.id} role="status" className="font-body-sm text-body-sm text-primary">
          Added &ldquo;{p.title}&rdquo;.{p.note ? ` ${p.note}` : ""}
        </p>
      ))}

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      {rows === null ? (
        <p className="font-body-sm text-body-sm text-secondary">Looking…</p>
      ) : visible.length === 0 ? (
        <p className="font-body-sm text-body-sm text-secondary">
          {query.trim()
            ? "No pages match. Try other words."
            : "You have no wiki pages yet. Type a topic to find public pages, or use Make learning material."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-background truncate">{p.title}</p>
                <p className="font-body-sm text-body-sm text-secondary">
                  {p.own ? "Your page" : "Public page"}
                  {p.own && p.visibility !== "public" ? ` · ${p.visibility === "team" ? "shared with some people" : "private"}` : ""}
                </p>
                {p.note && <p className="font-body-sm text-body-sm text-primary">{p.note}</p>}
              </div>
              <button
                type="button"
                onClick={() => add(p)}
                disabled={busyId === p.id}
                className="btn-outline shrink-0 px-4 py-1.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
              >
                {busyId === p.id ? "Adding…" : "Add"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
