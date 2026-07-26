"use client";

// Sign up — /signup.
//
// Route is /signup, not the old repo's /register, because the shared Nav in this
// repo already links to /signup (components/Nav.tsx). One name, and it is this
// one.
//
// UX ported from the old repo's app/register/page.tsx: the REAL password-strength
// meter (scored on length + character variety, not a decorative bar), confirm-
// password matching, show/hide toggles, inline error banner. Restyled to the
// centred-card system per design/stitch/smartdrugdiscovery_profile_setup_flow.
//
// AUTH: no Supabase here. signupAction → lib/auth.ts. The public.users row is
// created by the on_auth_user_created trigger, never by this page.
//
// EMAIL CONFIRMATION IS ON in this Supabase project (mailer_autoconfirm =
// false), so a successful signup has NO session and we render the "check your
// email" state. The code still handles confirmation being OFF — signupAction
// reports which happened via needsEmailConfirmation, so flipping the Supabase
// setting changes behaviour with no code change here.

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signupAction } from "@/app/auth/actions";
import { safeCallback } from "@/lib/safeRedirect";

// Real strength scoring, ported verbatim in spirit from the old repo: length
// tiers plus character variety. Never reports "Strong" for something that isn't.
function passwordStrength(pw: string): { score: number; label: string } {
  if (!pw) return { score: 0, label: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
  score = Math.min(score, 4);
  return { score, label: ["", "Weak", "Fair", "Good", "Strong"][score] };
}

const STRENGTH_TEXT = ["", "text-error", "text-tertiary", "text-secondary", "text-primary"];
const STRENGTH_BAR = ["", "bg-error", "bg-tertiary", "bg-secondary", "bg-primary"];

function SignupForm() {
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"));

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const strength = passwordStrength(password);
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    if (password !== confirmPassword) {
      setError("Those passwords don't match.");
      return;
    }

    setError("");
    setSubmitting(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const result = await signupAction(form);

    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    if (result.needsEmailConfirmation) {
      setSentTo(email); // confirmation ON — nothing to redirect to yet
      setSubmitting(false);
      return;
    }

    // Confirmation OFF: signUp returned a session, so we're already in.
    window.location.assign(callbackUrl);
  }

  // ── "check your email" ─────────────────────────────────────────────────────
  if (sentTo) {
    return (
      <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
        <div className="glass-panel rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-5xl text-primary">
            mark_email_unread
          </span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            Check your email
          </h1>
          <p className="mt-3 font-body-md text-body-md text-secondary">
            We sent a confirmation link to{" "}
            <span className="font-semibold text-on-background break-all">{sentTo}</span>. Open
            it to activate your account — you&apos;ll be signed in automatically.
          </p>
          <p className="mt-4 font-body-sm text-body-sm text-secondary">
            The link opens in this browser. Nothing else is needed until you click
            it.
          </p>
          <Link
            href="/login"
            className="btn-outline inline-block mt-7 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Back to log in
          </Link>
        </div>
      </div>
    );
  }

  // ── the form ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
      <header className="text-center">
        <h1 className="font-headline-lg text-headline-lg text-on-background">
          Create your account
        </h1>
        <p className="mt-3 font-body-md text-body-md text-secondary">
          Join the drug-discovery community — comment, collaborate and showcase
          your work.
        </p>
      </header>

      <div className="glass-panel rounded-2xl p-8 mt-8">
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
          {/* Carried through so the confirmation link returns them here */}
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

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
            <label htmlFor="password" className="block font-label-sm text-label-sm text-on-surface">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
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

            {/* Strength meter — 4 bars, filled to the real score */}
            {password && (
              <div className="pt-1">
                <div className="flex gap-1.5" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= strength.score ? STRENGTH_BAR[strength.score] : "bg-surface-container-high"
                      }`}
                    />
                  ))}
                </div>
                <p
                  className={`mt-1.5 font-label-sm text-label-sm ${STRENGTH_TEXT[strength.score]}`}
                  aria-live="polite"
                >
                  {strength.label}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="block font-label-sm text-label-sm text-on-surface"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              aria-invalid={mismatch}
              className={`w-full px-4 py-3 rounded-lg bg-surface-container-lowest border font-body-md text-body-md text-on-surface outline-none focus:ring-2 transition-all placeholder:text-on-surface-variant/40 ${
                mismatch
                  ? "border-error focus:border-error focus:ring-error/20"
                  : "border-outline-variant focus:border-primary focus:ring-primary/20"
              }`}
            />
            {mismatch && (
              <p className="font-label-sm text-label-sm text-error">
                Passwords don&apos;t match yet.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || mismatch}
            className="btn-primary w-full py-4 rounded-xl font-label-md text-label-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center font-body-md text-body-md text-secondary">
        Already have an account?{" "}
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="text-primary font-semibold hover:underline underline-offset-4"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
