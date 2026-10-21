"use client";

// The assistant's "check before creating" cards for communities: the top
// matches for a topic (name, members, who runs it where the viewer may see the
// roster, why it matched), each with Join or Request to join and Preview, and
// below them "Different focus? Create a new community". Joining uses the
// existing join action; nothing here creates a community.

import Link from "next/link";
import { matchAction, type CommunityMatch } from "@/lib/server/assistant/communityMatch";

export type MatchesState = {
  query: string;
  loading: boolean;
  failed: boolean;
  signedIn: boolean;
  matches: CommunityMatch[];
};

/** What happened to a card's button since the matches loaded. */
export type JoinProgress = "busy" | "active" | "pending" | { error: string };

export default function CommunityMatches({
  state,
  progress,
  busy,
  loginHref,
  onJoin,
  onCreateNew,
}: {
  state: MatchesState;
  progress: Record<string, JoinProgress>;
  busy: boolean;
  loginHref: string;
  onJoin: (m: CommunityMatch) => void;
  onCreateNew: () => void;
}) {
  if (state.loading) {
    return (
      <p className="font-body-md text-body-md text-secondary animate-pulse" role="status">
        Checking existing communities…
      </p>
    );
  }
  if (state.failed) {
    return <p className="font-body-sm text-body-sm text-error">Couldn&apos;t check existing communities just now.</p>;
  }
  if (state.matches.length === 0) {
    return (
      <p className="font-body-md text-body-md text-on-background">
        No existing community matches &ldquo;{state.query}&rdquo;.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Matching communities">
      <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">
        Existing communities
      </span>

      {state.matches.map((m) => {
        const act = matchAction(m);
        const p = progress[m.id];
        return (
          <div key={m.id} className="rounded-xl border border-outline-variant/30 bg-white p-3.5 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-label-lg text-label-lg text-on-background break-words">{m.name}</p>
                <p className="font-body-sm text-body-sm text-secondary">
                  {m.memberCount} {m.memberCount === 1 ? "member" : "members"}
                  {m.runBy ? ` · Run by ${m.runBy}` : ""}
                  {" · "}
                  {m.isOpen ? "Open" : "By request"}
                </p>
              </div>
            </div>
            {m.purpose && <p className="font-body-sm text-body-sm text-on-background line-clamp-2">{m.purpose}</p>}
            {m.why.length > 0 && (
              <p className="font-body-sm text-body-sm text-primary">Matches: {m.why.join(", ")}</p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              {act.kind === "join" || act.kind === "request" ? (
                p === "active" ? (
                  <span className="font-label-md text-label-md text-primary">You&apos;re in</span>
                ) : p === "pending" ? (
                  <span className="font-label-md text-label-md text-secondary">Request sent</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onJoin(m)}
                    disabled={busy || p === "busy"}
                    className="btn-primary px-4 py-1.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
                  >
                    {p === "busy" ? "…" : act.label}
                  </button>
                )
              ) : act.kind === "signin" ? (
                <Link
                  href={loginHref}
                  className="btn-primary px-4 py-1.5 rounded-lg font-label-md text-label-md"
                >
                  {act.label}
                </Link>
              ) : (
                <span className="font-label-md text-label-md text-secondary">{act.label}</span>
              )}
              <a
                href={`/communities/${m.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
              >
                Preview
              </a>
            </div>
            {p && typeof p === "object" && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {p.error}
              </p>
            )}
          </div>
        );
      })}

      {!state.signedIn && (
        <p className="font-body-sm text-body-sm text-secondary">Sign in to join or create a community.</p>
      )}

      <div className="rounded-xl border border-dashed border-primary/50 bg-primary/5 p-3.5 flex items-center gap-3">
        <p className="flex-1 font-body-sm text-body-sm text-on-background">
          <strong className="font-semibold">Different focus?</strong> Create a new community.
        </p>
        <button
          type="button"
          onClick={onCreateNew}
          disabled={busy}
          className="btn-outline shrink-0 px-4 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          Create a new community
        </button>
      </div>
    </div>
  );
}
