"use server";

// Server Actions for login / signup / logout. Same pattern as
// app/collaborate/actions.ts and app/promote/actions.ts.
//
// WHY THIS FILE EXISTS
// lib/auth.ts is server-only (it reads cookies via next/headers), so a "use
// client" page cannot import it. These actions are the bridge: the pages call
// them, they call the seam. The result is the property we actually want —
// NO PAGE IMPORTS @supabase/*, and the Oracle/UAB SSO swap changes lib/auth.ts
// and, at most, the bodies here.
//
// Everything crossing this boundary is a plain serialisable object; a caller
// never sees a Supabase error object, only the friendly string lib/auth.ts
// already mapped.

import { headers } from "next/headers";
import {
  deleteAccount,
  requestPasswordReset,
  signInWithEmail,
  signOut,
  signUp,
  updatePassword,
  ServerConfigError,
  UnauthorizedError,
  type AuthOutcome,
} from "@/lib/auth";
const CONFIG_ERROR = "Sign-in is not configured on this server.";

/** This deployment's origin, from the request. Emailed links must point back at
 *  the host the user is actually on, so it is never hardcoded or client-supplied. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  return (
    h.get("origin") ??
    (h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : "")
  );
}

export async function loginAction(formData: FormData): Promise<AuthOutcome> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Enter your email and password." };
  }

  try {
    return await signInWithEmail(email, password);
  } catch (e) {
    if (e instanceof ServerConfigError) return { ok: false, error: CONFIG_ERROR };
    console.error("loginAction failed", e);
    return { ok: false, error: "Couldn't sign you in. Please try again." };
  }
}

/** Create the account and sign in. No confirmation email is sent and no
 *  emailRedirectTo is passed — signup never routes through /auth/confirm. The
 *  page redirects to its own callbackUrl once this resolves. */
export async function signupAction(formData: FormData): Promise<AuthOutcome> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!email || !password) {
    return { ok: false, error: "Enter an email and a password." };
  }
  if (password !== confirm) {
    return { ok: false, error: "Those passwords don't match." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Passwords need to be at least 8 characters." };
  }

  try {
    return await signUp(email, password);
  } catch (e) {
    if (e instanceof ServerConfigError) return { ok: false, error: CONFIG_ERROR };
    console.error("signupAction failed", e);
    return { ok: false, error: "Couldn't create your account. Please try again." };
  }
}

export async function logoutAction(): Promise<void> {
  try {
    await signOut();
  } catch (e) {
    // Signing out must never leave the user stuck on a page that still looks
    // signed in — the caller navigates regardless of what happened here.
    console.error("logoutAction failed", e);
  }
}

// ── password reset ───────────────────────────────────────────────────────────

/** Request a reset email. The reply is identical for known and unknown
 *  addresses (see requestPasswordReset) — do not "improve" this by reporting
 *  whether the account exists. */
export async function requestPasswordResetAction(formData: FormData): Promise<AuthOutcome> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: "Enter your email address." };

  const origin = await requestOrigin();
  // /auth/confirm is now the PASSWORD-RECOVERY callback only — signup no longer
  // sends anyone through it. It exchanges whichever link shape arrives for a
  // session, then forwards to ?next=.
  const redirectTo = origin
    ? `${origin}/auth/confirm?next=${encodeURIComponent("/reset-password/update")}`
    : undefined;

  try {
    return await requestPasswordReset(email, redirectTo);
  } catch (e) {
    if (e instanceof ServerConfigError) return { ok: false, error: CONFIG_ERROR };
    console.error("requestPasswordResetAction failed", e);
    return { ok: false, error: "Couldn't send the reset email. Please try again." };
  }
}

export async function updatePasswordAction(formData: FormData): Promise<AuthOutcome> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (password !== confirm) return { ok: false, error: "Those passwords don't match." };
  if (password.length < 8) {
    return { ok: false, error: "Passwords need to be at least 8 characters." };
  }

  try {
    return await updatePassword(password);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return {
        ok: false,
        error: "This reset link has expired. Request a new one and try again.",
      };
    }
    if (e instanceof ServerConfigError) return { ok: false, error: CONFIG_ERROR };
    console.error("updatePasswordAction failed", e);
    return { ok: false, error: "Couldn't update your password. Please try again." };
  }
}

// ── account deletion ─────────────────────────────────────────────────────────

/** Thin pass-through. ALL deletion logic lives in lib/auth.ts deleteAccount() —
 *  deliberately, so the Oracle rewrite has exactly one target. Do not add row
 *  cleanup here. */
export async function deleteAccountAction(formData: FormData): Promise<AuthOutcome> {
  const confirmEmail = String(formData.get("confirmEmail") ?? "");
  if (!confirmEmail.trim()) {
    return { ok: false, error: "Type your email address to confirm." };
  }

  try {
    return await deleteAccount(confirmEmail);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in first." };
    if (e instanceof ServerConfigError) {
      return { ok: false, error: "Account deletion is not configured on this server." };
    }
    console.error("deleteAccountAction failed", e);
    return { ok: false, error: "Couldn't delete your account. Please try again." };
  }
}
