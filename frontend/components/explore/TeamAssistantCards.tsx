"use client";

// The two cards the assistant shows for a team command (lib/server/assistant/
// teamIntent.ts): a draft of a new team, and the list of the person's teams.
// Neither runs a search. The draft card creates through the same server action
// as /teams/new (createTeamAction -> createTeam -> kind 'team'); nothing is
// created until Create is pressed.

import { useState } from "react";
import Link from "next/link";
import { createTeamAction } from "@/app/teams/actions";
import { createTeamCallback, parseTeamName, TEAM_NAME_MAX } from "@/lib/server/teams/teamRules";
import { TEAM_CREATED_LINE, TEAM_NAME_QUESTION } from "@/lib/server/assistant/teamIntent";

export function TeamDraftCard({
  initialName,
  signedIn,
  authLoading,
  onCreated,
}: {
  initialName: string | null;
  signedIn: boolean;
  authLoading: boolean;
  /** Tells the panel a team was made (so the page's team lists can refresh). */
  onCreated?: () => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ slug: string; problems: string[] } | null>(null);

  if (done) {
    return (
      <div className="rounded-xl border border-primary bg-surface-container-low p-4 flex flex-col gap-3" role="status">
        <p className="font-body-md text-body-md text-on-background">{TEAM_CREATED_LINE}</p>
        {done.problems.length > 0 && (
          <p className="font-body-sm text-body-sm text-secondary">{done.problems.join(" ")}</p>
        )}
        <Link
          href={`/teams/${done.slug}`}
          className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md"
        >
          Open your team
        </Link>
      </div>
    );
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = parseTeamName(name);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    setError(null);
    const res = await createTeamAction({ name: parsed.name, emails });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone({ slug: res.slug, problems: res.problems });
    onCreated?.();
  };

  return (
    <form
      onSubmit={create}
      className="rounded-xl border border-outline-variant/40 bg-white p-4 flex flex-col gap-3"
    >
      <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">Draft team</span>
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">
          {initialName ? "Team name" : TEAM_NAME_QUESTION}
        </span>
        <input
          value={name}
          maxLength={TEAM_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          autoFocus={!initialName}
          className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>
      {signedIn && (
        <label className="flex flex-col gap-1">
          <span className="font-label-md text-label-md text-on-background">
            Invite by email <span className="text-secondary font-normal">(optional)</span>
          </span>
          <textarea
            value={emails}
            rows={2}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="name@example.com, another@example.com"
            className="resize-none bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      {!authLoading && !signedIn ? (
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(createTeamCallback(name))}`}
          className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md"
        >
          Sign in to create your team
        </Link>
      ) : (
        <button
          type="submit"
          disabled={busy || authLoading}
          className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      )}
    </form>
  );
}

export type TeamListState =
  | "loading"
  | { signedIn: false }
  | { signedIn: true; teams: { name: string; slug: string }[] }
  | { error: string };

export function TeamListCard({ state }: { state: TeamListState }) {
  if (state === "loading") {
    return (
      <p className="font-body-md text-body-md text-secondary animate-pulse" role="status">
        Looking up your teams…
      </p>
    );
  }
  if ("error" in state) {
    return (
      <p className="font-body-sm text-body-sm text-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (!state.signedIn) {
    return (
      <Link
        href={`/login?callbackUrl=${encodeURIComponent("/teams")}`}
        className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md"
      >
        Sign in to see your teams
      </Link>
    );
  }
  if (state.teams.length === 0) {
    return (
      <Link href="/teams/new" className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md">
        Create a team
      </Link>
    );
  }
  return (
    <ul className="rounded-xl border border-outline-variant/30 bg-white divide-y divide-outline-variant/20 overflow-hidden">
      {state.teams.map((t) => (
        <li key={t.slug}>
          <Link
            href={`/teams/${t.slug}`}
            className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-surface-container-low transition-colors font-label-md text-label-md text-on-background"
          >
            <span className="break-words min-w-0">{t.name}</span>
            <span className="material-symbols-outlined text-[18px] shrink-0">arrow_forward</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
