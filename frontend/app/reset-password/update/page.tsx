"use client";

// Set a new password — /reset-password/update.
//
// Where /auth/confirm forwards a recovery link once it has exchanged the token
// for a session. That session is what authorises the change, so this page needs
// no token of its own: updatePassword() in lib/auth.ts acts on the CURRENT
// session and refuses (UnauthorizedError → "this reset link has expired") when
// there isn't one. Landing here directly, without following a link, therefore
// fails safely rather than letting anyone set a password.
//
// Same strength meter as signup — one idea of what a good password is.

import Link from "next/link";
import { useState } from "react";
import { updatePasswordAction } from "@/app/auth/actions";
import { Banner, inputCls, labelCls } from "@/components/profile/FormUI";

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

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(password);
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await updatePasswordAction(new FormData(e.currentTarget));
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    setDone(true);
    setSubmitting(false);
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
        <div className="glass-panel rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-5xl text-primary">check_circle</span>
          <h1 className="mt-4 font-headline-md text-headline-md text-on-background">
            Password updated
          </h1>
          <p className="mt-3 font-body-md text-body-md text-secondary">
            You&apos;re signed in with your new password.
          </p>
          <Link
            href="/explore"
            className="btn-primary inline-block mt-7 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-24">
      <header className="text-center">
        <h1 className="font-headline-lg text-headline-lg text-on-background">
          Choose a new password
        </h1>
        <p className="mt-3 font-body-md text-body-md text-secondary">
          Pick something you don&apos;t use anywhere else.
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
            <label htmlFor="password" className={labelCls}>
              New password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={show ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={inputCls + " pr-12"}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-on-surface-variant/60 hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined">
                  {show ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>

            {password && (
              <div className="pt-2">
                <div className="flex gap-1.5" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= strength.score
                          ? STRENGTH_BAR[strength.score]
                          : "bg-surface-container-high"
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

          <div>
            <label htmlFor="confirmPassword" className={labelCls}>
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={show ? "text" : "password"}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              aria-invalid={mismatch}
              className={
                mismatch
                  ? inputCls.replace("border-outline-variant", "border-error") +
                    " focus:border-error focus:ring-error/20"
                  : inputCls
              }
            />
            {mismatch && (
              <p className="mt-1.5 font-label-sm text-label-sm text-error">
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
                Updating…
              </>
            ) : (
              "Update password"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
