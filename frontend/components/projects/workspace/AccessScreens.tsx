"use client";

// The two screens in front of an invite-only project. Neither carries any
// project data (no title, no details): the page renders them before it reads
// anything else.
//   SignInGate        signed out: sign in, come back to this same link
//   RestrictedAccess  signed in but not on the project

import { useState } from "react";
import Link from "next/link";
import { ssoLoginAction, switchAccountAction } from "@/app/auth/actions";
import { contactMailto } from "@/lib/server/projectWorkspace/colabofest";
import { COLABOFEST_CONTACT_EMAIL } from "@/lib/colabofestConfig";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md mx-auto px-margin-mobile md:px-0 py-16 md:py-24">
      <div className="glass-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-5 w-full">{children}</div>
    </div>
  );
}

function useStart(run: () => ReturnType<typeof ssoLoginAction>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await run();
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.assign(res.url);
  };
  return { busy, error, go };
}

export function SignInGate({ returnPath }: { returnPath: string }) {
  const { busy, error, go } = useStart(() => ssoLoginAction(returnPath));
  return (
    <Shell>
      <h1 className="font-headline-md text-headline-md text-on-background">Sign in to open your ColaboFest project</h1>
      <p className="font-body-md text-body-md text-secondary">Use the email address you used for your ColaboFest submission.</p>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="btn-primary w-full py-4 rounded-xl font-label-md text-label-md disabled:opacity-60"
      >
        {busy ? "Redirecting…" : "Sign in or create an account"}
      </button>
    </Shell>
  );
}

export function RestrictedAccess({
  returnPath,
  projectLink,
  email,
}: {
  returnPath: string;
  /** The full link to this project, put in the subject of the help email. */
  projectLink: string;
  email: string | null;
}) {
  const { busy, error, go } = useStart(() => switchAccountAction(returnPath));
  return (
    <Shell>
      <h1 className="font-headline-md text-headline-md text-on-background">Restricted access</h1>
      <p className="font-body-md text-body-md text-secondary">
        This project is only open to its team.{" "}
        {email ? (
          <>
            You are signed in as <strong className="text-on-background [overflow-wrap:anywhere]">{email}</strong>.
          </>
        ) : (
          "You are signed in."
        )}{" "}
        If this is your project, make sure you signed in with the email from your ColaboFest submission.
      </p>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="btn-primary sm:flex-1 px-5 py-3 rounded-xl font-label-md text-label-md whitespace-nowrap disabled:opacity-60"
        >
          {busy ? "Redirecting…" : "Sign in with a different email"}
        </button>
        <Link href="/projects" className="btn-outline px-5 py-3 rounded-xl font-label-md text-label-md text-center whitespace-nowrap">
          My projects
        </Link>
      </div>
      <p className="font-body-sm text-body-sm text-secondary">
        Still can&apos;t get in?{" "}
        <a href={contactMailto(projectLink)} className="text-primary underline underline-offset-4 [overflow-wrap:anywhere]">
          Email {COLABOFEST_CONTACT_EMAIL}
        </a>
      </p>
    </Shell>
  );
}
