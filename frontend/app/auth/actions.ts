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
  signInWithEmail,
  signOut,
  signUp,
  ServerConfigError,
  type AuthOutcome,
} from "@/lib/auth";
import { safeCallback } from "@/lib/safeRedirect";

const CONFIG_ERROR = "Sign-in is not configured on this server.";

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

export async function signupAction(formData: FormData): Promise<AuthOutcome> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  const next = safeCallback(formData.get("callbackUrl"));

  if (!email || !password) {
    return { ok: false, error: "Enter an email and a password." };
  }
  if (password !== confirm) {
    return { ok: false, error: "Those passwords don't match." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Passwords need to be at least 8 characters." };
  }

  // The confirmation email has to point back at THIS deployment, so the origin
  // is read from the request rather than hardcoded or taken from the client.
  const h = await headers();
  const origin =
    h.get("origin") ??
    (h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : "");
  const emailRedirectTo = origin
    ? `${origin}/auth/confirm?next=${encodeURIComponent(next)}`
    : undefined;

  try {
    return await signUp(email, password, emailRedirectTo);
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
