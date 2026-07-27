"use client";

// Log in — /login.
//
// UX ported from the old repo's app/login/page.tsx (show/hide password, inline
// error banner, spinner on submit, ?callbackUrl= round-trip). RESTYLED for this
// design system: the old page was a full-bleed split screen that assumed no
// shell, but this app renders Nav + Footer in the root layout, so it follows
// design/stitch/smartdrugdiscovery_profile_setup_flow instead — one centred card
// on the page background.
//
// AUTH: this page contains NO Supabase. It calls loginAction, which calls
// lib/auth.ts. That is the seam — see the SWAP POINT box in lib/auth.ts.
//
// After a successful sign-in we do a FULL navigation (window.location) rather
// than router.push. The session was just written to cookies by the server
// action, and AuthProvider reads cookies when it mounts — a client-side push
// would leave the Nav showing "Log in" until the next hard load.

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction } from "@/app/auth/actions";
import { safeCallback } from "@/lib/safeRedirect";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"));
  const justConfirmed = searchParams.get("confirmed");

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);

    const result = await loginAction(new FormData(e.currentTarget));

    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    window.location.assign(callbackUrl);
  }

  return (
    <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
      <header className="text-center">
        <h1 className="font-headline-lg text-headline-lg text-on-background">Welcome back</h1>
        <p className="mt-3 font-body-md text-body-md text-secondary">
          Log in to comment, collaborate and submit your work.
        </p>
      </header>

      <div className="glass-panel rounded-2xl p-8 mt-8">
        {justConfirmed === "failed" && (
          <div
            className="flex items-start gap-2 p-3 mb-6 rounded-lg bg-error-container border border-error/20 text-on-error-container"
            role="alert"
          >
            <span className="material-symbols-outlined text-[20px]">error</span>
            <span className="font-body-md text-body-md">
              That confirmation link didn&apos;t work — it may have expired or
              already been used. Try logging in below.
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

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="email" className="block font-label-sm text-label-sm text-on-surface">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@university.edu"
              className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-md text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-on-surface-variant/40"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block font-label-sm text-label-sm text-on-surface">
                Password
              </label>
              <Link
                href="/reset-password"
                className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full pl-4 pr-12 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-md text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-on-surface-variant/40"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-on-surface-variant/60 hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined">
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-4 rounded-xl font-label-md text-label-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              "Log in"
            )}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center font-body-md text-body-md text-secondary">
        Don&apos;t have an account?{" "}
        <Link
          href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="text-primary font-semibold hover:underline underline-offset-4"
        >
          Sign up
        </Link>
      </p>
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
