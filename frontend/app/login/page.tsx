"use client";

// Log in — /login.
//
// SSO ONLY. This used to be an email + password form; SPARC now runs behind
// Keycloak SSO (custom OIDC provider `custom:sdd` registered in Supabase),
// so there is exactly one control here: a single button that starts the
// redirect. No email/password fields, no "forgot password" link (SSO owns
// credentials — see lib/auth.ts's password-reset section for why that code
// is left in place but unreachable), no "sign up" link (/signup itself now
// redirects here — SSO handles registration on first sign-in).
//
// AUTH: this page contains NO Supabase. It calls ssoLoginAction, which calls
// lib/auth.ts. That is the seam — see the SPARC SSO box in lib/auth.ts.
// ssoLoginAction returns the Keycloak authorization URL; this page does the
// actual cross-origin navigation, since only the browser can do that.

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ssoLoginAction } from "@/app/auth/actions";
import { safeCallback } from "@/lib/safeRedirect";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"));
  const ssoFailed = searchParams.get("sso") === "failed";

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    if (submitting) return;
    setError("");
    setSubmitting(true);

    const result = await ssoLoginAction(callbackUrl);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    window.location.assign(result.url);
  }

  return (
    <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
      <header className="text-center">
        <h1 className="font-headline-lg text-headline-lg text-on-background">Welcome back</h1>
        <p className="mt-3 font-body-md text-body-md text-secondary">
          Sign in with your SmartDrugDiscovery account to comment, collaborate and submit your
          work.
        </p>
      </header>

      <div className="glass-panel rounded-2xl p-8 mt-8">
        {ssoFailed && (
          <div
            className="flex items-start gap-2 p-3 mb-6 rounded-lg bg-error-container border border-error/20 text-on-error-container"
            role="alert"
          >
            <span className="material-symbols-outlined text-[20px]">error</span>
            <span className="font-body-md text-body-md">
              Sign-in didn&apos;t complete — please try again.
            </span>
          </div>
        )}

        {error && (
          <div
            className="flex items-start gap-2 p-3 mb-6 rounded-lg bg-error-container border border-error/20 text-on-error-container"
            role="alert"
          >
            <span className="material-symbols-outlined text-[20px]">error</span>
            <span className="font-body-md text-body-md">{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSignIn}
          disabled={submitting}
          className="btn-primary w-full py-4 rounded-xl font-label-md text-label-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Redirecting…
            </>
          ) : (
            "Sign in with SmartDrugDiscovery"
          )}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams must sit inside <Suspense> — see the "use client" boundary
  // rule in CLAUDE.md.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
