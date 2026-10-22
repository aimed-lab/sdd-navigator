"use client";

// The right-hand column of /explore/<topic> (below the results on a phone):
// keep this up to date (starts the assistant's usual save flow, with its
// confirm step), ask a follow-up (two suggestions that open the assistant), and
// people on this (the best matching community, or nothing).

import Link from "next/link";
import { useEffect, useState } from "react";
import { joinCommunityAction } from "@/app/communities/actions";
import { useAuth } from "@/context/AuthContext";
import { followUpsFor } from "@/lib/server/assistant/assistantAnswer";
import { openAssistant, saveAsLivingPageMessage } from "@/lib/server/assistant/assistantBridge";
import { matchAction, pickPeopleMatch, type CommunityMatch } from "@/lib/server/assistant/communityMatch";
import type { ExploreSection } from "@/types/explore";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-outline-variant/30 p-5 flex flex-col gap-3">
      <h2 className="font-title text-[18px] leading-tight font-medium text-on-background">{title}</h2>
      {children}
    </section>
  );
}

function PeopleOnThis({ topic }: { topic: string }) {
  const { user } = useAuth();
  const [match, setMatch] = useState<CommunityMatch | null>(null);
  const [done, setDone] = useState<"active" | "pending" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMatch(null);
    setDone(null);
    (async () => {
      try {
        const res = await fetch(`/api/communities/match?q=${encodeURIComponent(topic)}`, { cache: "no-store" });
        const json = await res.json();
        const valid: CommunityMatch[] = (Array.isArray(json?.matches) ? json.matches : []).filter(
          (m: unknown): m is CommunityMatch =>
            !!m && typeof m === "object" && typeof (m as CommunityMatch).id === "string" && typeof (m as CommunityMatch).slug === "string" && typeof (m as CommunityMatch).name === "string"
        );
        // Prefer a community the viewer is not in yet.
        const best = pickPeopleMatch(valid);
        if (!cancelled && best) setMatch(best);
      } catch {
        /* nothing matches, or the check failed: the card stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topic]);

  if (!match) return null;
  const act = matchAction({ isOpen: match.isOpen, state: user ? match.state : "signed_out" });

  return (
    <Card title="People on this">
      <div className="flex flex-col gap-1">
        <Link href={`/communities/${match.slug}`} className="font-label-lg text-label-lg text-on-background hover:text-primary break-words">
          {match.name}
        </Link>
        <p className="font-body-sm text-body-sm text-secondary">
          {match.memberCount} {match.memberCount === 1 ? "member" : "members"}
          {match.runBy ? ` · Run by ${match.runBy}` : ""}
        </p>
        {match.why.length > 0 && <p className="font-body-sm text-body-sm text-primary">Matches: {match.why.join(", ")}</p>}
      </div>
      {done ? (
        <p className="font-label-md text-label-md text-primary">{done === "active" ? "You're in" : "Request sent"}</p>
      ) : act.kind === "join" || act.kind === "request" ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await joinCommunityAction(match.id, match.isOpen, match.slug);
            setBusy(false);
            if (res.ok) setDone(match.isOpen ? "active" : "pending");
            else setError(res.error);
          }}
          className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {busy ? "…" : act.label}
        </button>
      ) : user && match.state === "active" ? (
        <p className="font-label-md text-label-md text-secondary">
          You&apos;re a member ·{" "}
          <Link href={`/communities/${match.slug}`} className="text-primary hover:underline underline-offset-4">
            Open
          </Link>
        </p>
      ) : act.kind === "signin" ? (
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(`/explore/${encodeURIComponent(topic)}`)}`}
          className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md"
        >
          {act.label}
        </Link>
      ) : (
        <p className="font-label-md text-label-md text-secondary">{act.label}</p>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

export default function ResultsSidebar({ topic, sections }: { topic: string; sections: ExploreSection[] }) {
  const questions = followUpsFor(sections, topic).slice(0, 2);

  return (
    <aside className="flex flex-col gap-4 min-w-0" aria-label="Next steps">
      <Card title="Keep this up to date">
        <p className="font-body-sm text-body-sm text-secondary">
          A living page collects new papers and trials on this topic every day.
        </p>
        <button
          type="button"
          onClick={() => openAssistant({ text: saveAsLivingPageMessage(topic), mode: "send" })}
          className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md"
        >
          Save as living page
        </button>
      </Card>

      <Card title="Ask a follow-up">
        <div className="flex flex-col gap-2">
          {questions.map((q) => (
            <button
              key={q.text}
              type="button"
              onClick={() => openAssistant({ text: q.text, mode: "send" })}
              className="text-left px-3.5 py-2.5 rounded-xl border border-outline-variant/30 hover:border-primary hover:text-primary font-body-sm text-body-sm text-on-background transition-colors"
            >
              {q.text}
            </button>
          ))}
        </div>
      </Card>

      <PeopleOnThis topic={topic} />
    </aside>
  );
}
