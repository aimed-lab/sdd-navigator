"use client";

// What someone sees when they open a team they are not on (a QR scan or a
// shared link): the team's name, its description and ONE button. Signed in:
// "Join this team", instant. Signed out: join with just an email (the existing
// email join), or sign in. Nothing else about the team is shown.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { joinTeamAction, joinTeamByEmailAction } from "@/app/teams/actions";
import { joinView } from "@/lib/server/teams/teamRules";
import type { MembershipState } from "@/lib/server/communities";

export default function TeamJoinCard({
  teamId,
  slug,
  name,
  description,
  state,
  autoOpen,
  autoJoin,
}: {
  teamId: string;
  slug: string;
  name: string;
  description: string | null;
  state: MembershipState;
  /** Arrived by QR / join link (?join=1): open the email box straight away. */
  autoOpen: boolean;
  /** Came back from signing in on this team's join link (?join=signin): join now. */
  autoJoin: boolean;
}) {
  const router = useRouter();
  const view = joinView(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(autoOpen);
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const signIn = `/login?callbackUrl=${encodeURIComponent(`/teams/${slug}?join=signin`)}`;

  const tried = useRef(false);
  useEffect(() => {
    if (autoJoin && state === "none" && !tried.current) {
      tried.current = true;
      void join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, state]);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await joinTeamAction(slug);
    if (res.ok) router.refresh();
    else {
      setError(res.error);
      setBusy(false);
    }
  };

  const joinByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await joinTeamByEmailAction(slug, email);
    setBusy(false);
    if (res.ok) setDone(res.message);
    else setError(res.error);
  };

  return (
    <section className="rounded-2xl bg-primary text-on-primary overflow-hidden">
      <div className="p-6 sm:p-8 flex flex-col gap-4 max-w-2xl">
        <span className="font-label-sm text-label-sm tracking-widest text-on-primary/80">TEAM · PRIVATE</span>
        <h1 className="font-headline-lg text-headline-lg text-on-primary break-words">{name}</h1>
        {description && <p className="font-body-lg text-body-lg text-on-primary/90">{description}</p>}

        <div className="rounded-xl bg-surface-container-lowest text-on-background p-4 flex flex-col gap-3 max-w-sm">
          {view === "pending" && (
            <p className="font-body-md text-body-md text-secondary">Your request is waiting. A team lead will let you in.</p>
          )}

          {view === "join_button" && (
            <button
              type="button"
              onClick={join}
              disabled={busy}
              className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {busy ? "Joining…" : "Join this team"}
            </button>
          )}

          {view === "email_or_sign_in" && !done && (
            <>
              {!emailOpen ? (
                <button
                  type="button"
                  onClick={() => setEmailOpen(true)}
                  className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md"
                >
                  Join this team
                </button>
              ) : (
                <form onSubmit={joinByEmail} className="flex flex-col gap-2">
                  <label htmlFor="team-join-email" className="font-label-md text-label-md">
                    Join with your email
                  </label>
                  <input
                    id="team-join-email"
                    type="email"
                    required
                    autoFocus={autoOpen}
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2.5 font-body-sm text-body-sm text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
                  >
                    {busy ? "Joining…" : "Join this team"}
                  </button>
                  <p className="font-body-sm text-body-sm text-secondary">No password, no account needed.</p>
                </form>
              )}
              <Link href={signIn} className="font-label-sm text-label-sm text-secondary hover:text-primary">
                Have an account? Sign in
              </Link>
            </>
          )}

          {done && (
            <p role="status" className="rounded-lg bg-surface-container-low text-primary px-3 py-2.5 font-body-sm text-body-sm">
              {done}{" "}
              <Link href={signIn} className="underline underline-offset-4">
                Sign in
              </Link>
            </p>
          )}

          {error && (
            <p className="font-body-sm text-body-sm text-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
