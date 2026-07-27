"use client";

// Request a password reset — /reset-password.
//
// Reached from "Forgot password?" on /login. Sends a Supabase recovery email
// whose link lands on /auth/confirm — now the recovery callback only, since
// signup no longer sends confirmation emails — which establishes a recovery
// session and forwards to /reset-password/update.
//
// The success state is shown for ANY submitted address, including ones with no
// account. That is deliberate — see requestPasswordReset in lib/auth.ts: a page
// that says "no account with that email" is a free user-enumeration oracle.
//
// AUTH: no Supabase here. requestPasswordResetAction → lib/auth.ts.

import Link from "next/link";
import { useState } from "react";
import { requestPasswordResetAction } from "@/app/auth/actions";
import { Banner } from "@/components/profile/FormUI";
import { inputCls, labelCls } from "@/components/profile/FormUI";

export default function ResetPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await requestPasswordResetAction(new FormData(e.currentTarget));
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  return (
    <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
      {sent ? (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-5xl text-primary">outgoing_mail</span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            Check your email
          </h1>
          <p className="mt-3 font-body-md text-body-md text-secondary">
            If an account exists for that address, a reset link is on its way.
            Open it in this browser to choose a new password.
          </p>
          <Link
            href="/login"
            className="btn-outline inline-block mt-7 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Back to log in
          </Link>
        </div>
      ) : (
        <>
          <header className="text-center">
            <h1 className="font-headline-lg text-headline-lg text-on-background">
              Reset your password
            </h1>
            <p className="mt-3 font-body-md text-body-md text-secondary">
              Enter your email and we&apos;ll send you a link to set a new one.
            </p>
          </header>

          <div className="glass-panel rounded-2xl p-8 mt-8">
            {error && (
              <div className="mb-6">
                <Banner kind="error">{error}</Banner>
              </div>
            )}

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className={labelCls}>
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@university.edu"
                  className={inputCls}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-4 rounded-xl font-label-md text-label-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send reset link"
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center font-body-md text-body-md text-secondary">
            Remembered it?{" "}
            <Link
              href="/login"
              className="text-primary font-semibold hover:underline underline-offset-4"
            >
              Log in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
