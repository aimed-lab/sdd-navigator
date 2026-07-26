// =============================================================================
// lib/auth.ts — THE AUTH SEAM.
// =============================================================================
// Every feature module AND every auth page gets its identity through this file
// and NEVER imports @supabase/* directly. That is the whole point of the file:
// it is the single place that knows Supabase is the identity provider.
//
// Two groups of exports:
//   • READS    — getCurrentUser / getSession / requireCurrentUser / getDb.
//                Used by lib/server/* and server components to answer "who is
//                this and what may they touch".
//   • SESSION  — signInWithEmail / signUp / signOut / confirmEmailLink.
//                Used ONLY by app/auth/actions.ts, which the login and signup
//                pages call. No page imports this module directly (it is
//                server-only) and no page imports Supabase.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ SWAP POINT — Oracle / UAB SSO migration                                   │
// │                                                                           │
// │ When identity moves off Supabase Auth, ONLY this file changes. Reimplement │
// │ the functions below against the new provider and every caller keeps        │
// │ working, because callers depend on the AuthUser / AuthOutcome shapes and   │
// │ on requireCurrentUser() throwing UnauthorizedError — not on Supabase.      │
// │                                                                           │
// │ Expect the SESSION group to change shape most: under SSO, signInWithEmail  │
// │ and signUp are replaced by an IdP redirect, and email confirmation stops   │
// │ being ours to manage. They are server-side already precisely so that       │
// │ redirect flow drops in here without touching a single page.                │
// │                                                                           │
// │ The one thing a replacement MUST preserve: `getDb()` returns a client that │
// │ carries the caller's identity, because Postgres RLS (auth.uid() = ...) is  │
// │ the real enforcement layer. If the new provider can't produce a            │
// │ request-scoped DB identity, the RLS policies in database/schema.sql need   │
// │ revisiting at the same time — they are not app-level checks that can be    │
// │ swapped independently.                                                    │
// └───────────────────────────────────────────────────────────────────────────┘

import {
  ServerConfigError,
  UnauthorizedError,
  getSessionClient,
  requireUser,
} from "@/lib/server/supabaseServer";

// Re-exported so callers can catch/handle these without reaching past this file.
export { ServerConfigError, UnauthorizedError };

/** The provider-agnostic identity shape the app codes against. */
export type AuthUser = {
  id: string;
  email: string | null;
};

/** Result of a sign-in / sign-up attempt.
 *
 *  `needsEmailConfirmation` is the branch the UI renders on: true means the
 *  account exists but has no session yet, so the caller must show "check your
 *  email" instead of redirecting. Under SSO this is always false — the IdP owns
 *  verification — which is exactly why it's a field and not a caller-side guess
 *  about Supabase's configuration. */
export type AuthOutcome =
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; error: string };

/** Supabase's raw auth errors are either too technical or too revealing to show
 *  a user verbatim. This is the ONE place that translation happens, so swapping
 *  providers doesn't scatter new message-matching through the pages.
 *
 *  Deliberately does NOT distinguish "no such account" from "wrong password":
 *  that difference is a user-enumeration oracle. */
function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email or password isn't right.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirm your email first — check your inbox for the link.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with that email already exists. Try logging in.";
  }
  if (m.includes("password should be") || m.includes("password is too short")) {
    return "Passwords need to be at least 8 characters.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  // Supabase rejects some domains outright (reserved TLDs like .invalid/.test,
  // and anything its deliverability check dislikes), reported as
  // error_code "email_address_invalid".
  if (
    m.includes("unable to validate email") ||
    m.includes("invalid email") ||
    (m.includes("email address") && m.includes("invalid"))
  ) {
    return "That email address isn't accepted. Try a different one.";
  }
  // Deliberately neutral: this mapper is shared by sign-in AND sign-up, so it
  // must not assert which one the user was doing.
  return "Something went wrong. Please try again.";
}

/** The current user, or null when signed out. Never throws for "signed out" —
 *  use this for gating UI (show "Sign in to post" instead of a form). */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = await getSessionClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** The current session's user plus the identity-carrying DB client, or null.
 *  Prefer requireCurrentUser() for writes. */
export async function getSession(): Promise<{ user: AuthUser; db: Db } | null> {
  const supabase = await getSessionClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    db: supabase as Db,
  };
}

/** Like getCurrentUser() but THROWS UnauthorizedError when signed out. The
 *  gateway for every write: the uid comes from the validated session here, never
 *  from a request body. */
export async function requireCurrentUser(): Promise<{ user: AuthUser; db: Db }> {
  const { supabase, user } = await requireUser();
  return { user: { id: user.id, email: user.email ?? null }, db: supabase as Db };
}

// ── auth OPERATIONS (sign in / sign up / sign out) ───────────────────────────
//
// These run SERVER-SIDE, from Server Actions and Route Handlers, for two
// reasons that both matter for Monday:
//
//   1. The session lands in httpOnly-capable cookies written by the same client
//      getDb()/requireCurrentUser() read, so server components, RLS and the
//      pages agree about who you are the moment the action returns.
//   2. SSO is a REDIRECT flow. An IdP hand-off cannot be driven from a browser
//      SDK call, so putting these on the server now means the swap replaces the
//      bodies of these functions and touches no page at all.
//
// Pages never call these directly (they can't — this module is server-only).
// They go through app/auth/actions.ts, which is the only caller.

/** Sign in with email + password. Sets the session cookies as a side effect. */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };

  return { ok: true, needsEmailConfirmation: false };
}

/**
 * Register a new account.
 *
 * The public.users profile row is NOT written here. The `on_auth_user_created`
 * trigger (database/schema.sql) mirrors the new auth user into public.users with
 * SECURITY DEFINER rights. That is load-bearing while email confirmation is ON:
 * signUp() returns no session, so an insert from here would have no identity and
 * would be refused by the users-table RLS policy.
 *
 * @param emailRedirectTo Absolute URL Supabase sends the confirmation link to.
 *        Must be on the Supabase project's redirect allowlist.
 */
export async function signUp(
  email: string,
  password: string,
  emailRedirectTo?: string
): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by handle_new_user() to seed users.name without a second write.
      data: { name: email.split("@")[0] },
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  });

  if (error) return { ok: false, error: friendlyAuthError(error.message) };

  // Supabase does not error on a duplicate signup — it returns a decoy user with
  // an EMPTY identities array so an attacker can't enumerate registered emails.
  // We keep that property: the message below is the same one a genuinely new
  // user would see, so the response doesn't reveal whether the email exists.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { ok: true, needsEmailConfirmation: true };
  }

  // A session here means confirmation is OFF in this project and the user is
  // already signed in; no session means the confirmation email is on its way.
  return { ok: true, needsEmailConfirmation: !data.session };
}

/** Sign out and clear the session cookies. */
export async function signOut(): Promise<void> {
  const supabase = await getSessionClient();
  if (!supabase) return; // already effectively signed out
  await supabase.auth.signOut();
}

/** Complete an email-confirmation link. Handles both link styles Supabase
 *  emits — PKCE (`?code=`) and the token-hash template (`?token_hash=&type=`) —
 *  because which one arrives depends on the project's email template, not on
 *  anything this app controls. */
export async function confirmEmailLink(params: {
  code?: string | null;
  tokenHash?: string | null;
  type?: string | null;
}): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true, needsEmailConfirmation: false };
  }

  if (params.tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: (params.type as "signup" | "email") ?? "signup",
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true, needsEmailConfirmation: false };
  }

  return { ok: false, error: "That confirmation link is incomplete." };
}

/** A request-scoped DB client carrying the caller's identity (so RLS applies).
 *  Signed out, this is still valid — it just sees only what public policies
 *  allow, which is exactly what the public board read needs. */
export async function getDb(): Promise<Db | null> {
  const supabase = await getSessionClient();
  return (supabase as Db) ?? null;
}

// The DB client type is intentionally opaque to callers — they only ever use it
// as "the thing lib/server/* passes to Supabase queries". Typed loosely here so
// swapping the provider doesn't ripple a type change through every caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;
