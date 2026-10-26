"use client";

// What someone sees when they open a team they are not on (a QR scan or a
// shared link): the team's name, its description and ONE button, "Join this
// team". Signed in: joins right away. Signed out: goes straight to SSO sign-in
// and comes back to this same team page (?join=signin), where the page joins
// them on the server. Nothing else about the team is shown.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinTeamAction } from "@/app/teams/actions";
import { ssoLoginAction } from "@/app/auth/actions";
import { joinView, teamReturnPath } from "@/lib/server/teams/teamRules";
import type { MembershipState } from "@/lib/server/communities";

export default function TeamJoinCard({
  slug,
  name,
  description,
  state,
  initialError,
}: {
  slug: string;
  name: string;
  description: string | null;
  state: MembershipState;
  /** Why the automatic join after sign-in did not work, if it did not. */
  initialError?: string | null;
}) {
  const router = useRouter();
  const view = joinView(state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

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

  // Signed out: start SSO with this team's page as the place to come back to.
  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await ssoLoginAction(teamReturnPath(slug));
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.assign(res.url);
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

          {(view === "join_button" || view === "sign_in_button") && (
            <button
              type="button"
              onClick={view === "join_button" ? join : signIn}
              disabled={busy}
              className="btn-primary px-5 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {busy ? (view === "join_button" ? "Joining…" : "Opening sign-in…") : "Join this team"}
            </button>
          )}

          {view === "sign_in_button" && (
            <p className="font-body-sm text-body-sm text-secondary">New here? Sign in or create an account in one step.</p>
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
