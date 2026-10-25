"use client";

// The one-line description under a team's name. Leads can edit it in place.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTeamDetailsAction } from "@/app/teams/actions";

export default function TeamDescription({
  teamId,
  slug,
  description,
  isLead,
}: {
  teamId: string;
  slug: string;
  description: string | null;
  isLead: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <p className="font-body-lg text-body-lg text-on-primary/90 max-w-2xl">
        {description ? (
          description
        ) : isLead ? (
          <span className="text-on-primary/70">Add a one-line description so people know what this team is for.</span>
        ) : null}
        {isLead && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-2 align-middle inline-flex items-center gap-1 font-label-sm text-label-sm text-on-primary/80 hover:text-on-primary underline underline-offset-4"
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
            {description ? "Edit" : "Add"}
          </button>
        )}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 max-w-2xl"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const res = await updateTeamDetailsAction(teamId, slug, { description: value });
        setBusy(false);
        if (res.ok) {
          setEditing(false);
          router.refresh();
        } else setError(res.error);
      }}
    >
      <label htmlFor="team-description" className="sr-only">
        Team description
      </label>
      <input
        id="team-description"
        value={value}
        maxLength={160}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        placeholder="What is this team for?"
        className="rounded-lg px-3 py-2 bg-white text-on-background font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-white/60"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-1.5 rounded-lg bg-white text-primary font-label-md text-label-md disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(description ?? "");
            setError(null);
          }}
          className="font-label-md text-label-md text-on-primary/90 hover:text-on-primary"
        >
          Cancel
        </button>
        {error && <span className="font-body-sm text-body-sm text-on-primary" role="alert">{error}</span>}
      </div>
    </form>
  );
}
