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
// │ SPARC SSO — LIVE. Supabase Auth is still the session layer; it now         │
// │ federates identity to the lab's Keycloak (issuer                          │
// │ auth.smartdrugdiscovery.org/realms/sdd) via a custom OIDC provider         │
// │ registered in Supabase as `custom:sdd`. signInWithSSO() below starts that  │
// │ redirect. auth.uid() and every RLS policy / SECURITY DEFINER function are  │
// │ untouched — they were never coupled to *how* the session got established. │
// │                                                                           │
// │ signInWithEmail / signUp / requestPasswordReset / updatePassword /         │
// │ confirmEmailLink still exist below and still work, but nothing in the UI   │
// │ calls them anymore — SSO is the only reachable sign-in path. Left in place │
// │ deliberately (not deleted) in case a break-glass path is ever needed.      │
// │                                                                           │
// │ A FUTURE swap off Supabase Auth entirely still only touches this file:     │
// │ callers depend on the AuthUser / AuthOutcome shapes and on                 │
// │ requireCurrentUser() throwing UnauthorizedError, not on Supabase. The one  │
// │ thing a replacement MUST preserve: `getDb()` returns a client that carries │
// │ the caller's identity, because Postgres RLS (auth.uid() = ...) is the      │
// │ real enforcement layer. If a new provider can't produce a request-scoped   │
// │ DB identity, the RLS policies in database/schema.sql need revisiting at    │
// │ the same time — they are not app-level checks that can be swapped          │
// │ independently.                                                            │
// └───────────────────────────────────────────────────────────────────────────┘

import {
  ServerConfigError,
  UnauthorizedError,
  getServiceRoleClient,
  getSessionClient,
} from "@/lib/server/supabaseServer";

// Re-exported so callers can catch/handle these without reaching past this file.
export { ServerConfigError, UnauthorizedError };

/** The provider-agnostic identity shape the app codes against. */
export type AuthUser = {
  id: string;
  email: string | null;
};

/** Result of an auth operation. `ok: true` always means "done, and the session
 *  cookies now reflect it" — there is no intermediate "pending confirmation"
 *  state for a caller to handle.
 *
 *  (This previously carried a `needsEmailConfirmation` flag. Email confirmation
 *  was removed from signup, so every success is now immediate.) */
export type AuthOutcome = { ok: true } | { ok: false; error: string };

/** Result of starting an SSO redirect — carries the IdP authorization URL the
 *  caller must navigate the browser to, since signInWithOAuth() cannot do
 *  that itself from server-side code (only the browser SDK auto-redirects). */
export type SSORedirectOutcome = { ok: true; url: string } | { ok: false; error: string };

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
 *  from a request body.
 *
 *  THE single place every lib/server/* write goes through — this used to
 *  delegate to a `requireUser()` in lib/server/supabaseServer.ts, which made
 *  that file a second, independent call site for `supabase.auth.getUser()`.
 *  Owning the call here instead means a provider swap only ever touches this
 *  file, not supabaseServer.ts too — see the SWAP POINT box above. */
export async function requireCurrentUser(): Promise<{ user: AuthUser; db: Db }> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();

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

// ── SSO (SPARC Keycloak, `custom:sdd`) ───────────────────────────────────────
//
// Supabase Auth stays the SESSION layer — it federates identity to Keycloak
// via a registered custom OIDC provider, but auth.uid() and the session
// cookies work exactly as before. Nothing in RLS or any SECURITY DEFINER
// function changes for this; they were never coupled to *how* the session
// was established, only to Supabase Auth issuing it.

/** Begin the SPARC SSO sign-in redirect. Returns the Keycloak authorization
 *  URL for the caller to navigate the browser to. `redirectTo` must be this
 *  app's own /auth/callback route (with `?next=` already appended) — Keycloak
 *  and Supabase both need to land back on our origin before the final
 *  destination redirect happens. */
export async function signInWithSSO(redirectTo: string): Promise<SSORedirectOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { data, error } = await supabase.auth.signInWithOAuth({
    // Supabase's `Provider` union predates custom OIDC providers — `custom:sdd`
    // is a real, dashboard-registered identifier the API accepts at runtime,
    // just not one the SDK's own type knows about yet.
    provider: "custom:sdd" as unknown as Parameters<
      typeof supabase.auth.signInWithOAuth
    >[0]["provider"],
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    return { ok: false, error: friendlyAuthError(error?.message ?? "") };
  }
  return { ok: true, url: data.url };
}

/** Sign in with email + password. Sets the session cookies as a side effect. */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };

  return { ok: true };
}

/**
 * Register a new account and sign the user straight in.
 *
 * ONE STEP, NO EMAIL. Email confirmation is disabled for this project, so
 * signUp() returns a session immediately and the cookies are set here. There is
 * no confirmation link, no "check your email" screen, and the caller redirects
 * as soon as this resolves.
 *
 * The public.users profile row is NOT written here — the `on_auth_user_created`
 * trigger (database/schema.sql) mirrors the new auth user into public.users with
 * SECURITY DEFINER rights. That stays the right place for it: the trigger runs
 * inside the same insert regardless of whether a session exists, so profile
 * creation never depends on the confirmation setting.
 */
export async function signUp(email: string, password: string): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Read by handle_new_user() to seed users.name without a second write.
    options: { data: { name: email.split("@")[0] } },
  });

  if (error) return { ok: false, error: friendlyAuthError(error.message) };

  // Supabase does not error on a duplicate signup — it returns a decoy user with
  // an EMPTY identities array so an attacker can't enumerate registered emails.
  // With confirmation off there is no email to swallow the ambiguity, so say
  // plainly that the address is taken; the alternative is a "success" that
  // silently fails to sign anyone in.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { ok: false, error: "An account with that email already exists. Try logging in." };
  }

  // No session means the project's "Confirm email" setting is back ON. Rather
  // than redirect to a page that will bounce the user straight back to /login,
  // fail loudly — this is a configuration problem, not a user error.
  if (!data.session) {
    console.error(
      "signUp returned no session — Supabase 'Confirm email' appears to be enabled. " +
        "Disable it (Authentication → Providers → Email) or restore the confirmation flow."
    );
    return {
      ok: false,
      error: "Account creation isn't fully configured on this server. Please contact support.",
    };
  }

  return { ok: true };
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
    return { ok: true };
  }

  if (params.tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      // "recovery" is the password-reset link; "signup"/"email" are confirmations.
      type: (params.type as "signup" | "email" | "recovery") ?? "signup",
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  }

  return { ok: false, error: "That confirmation link is incomplete." };
}

// ── password reset ───────────────────────────────────────────────────────────
//
// SSO NOTE: both of these disappear under Oracle/UAB SSO — an institutional IdP
// owns credentials, and "forgot password" becomes a link out to the IdP's own
// reset page. They live here so that removal is a change to this file plus the
// deletion of two routes, not an audit of every page.

/** Send a password-reset email. Always reports success, even for an unknown
 *  address: telling a caller "no account with that email" turns this endpoint
 *  into a free user-enumeration oracle. */
export async function requestPasswordReset(
  email: string,
  redirectTo?: string
): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : undefined
  );

  // Rate limiting is the one failure worth surfacing — the user can act on it
  // ("wait and retry") and it does not reveal whether the account exists.
  if (error && /rate limit|too many/i.test(error.message)) {
    return { ok: false, error: friendlyAuthError(error.message) };
  }
  if (error) console.error("requestPasswordReset failed", error.message);

  return { ok: true };
}

/** Set a new password for the CURRENT session. Requires the recovery session
 *  established by the emailed link (or a normal signed-in session). */
export async function updatePassword(newPassword: string): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: friendlyAuthError(error.message) };
  return { ok: true };
}

// ── account deletion ─────────────────────────────────────────────────────────

/**
 * Permanently delete the caller's account and everything they own.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ MIGRATION POINT — this function is the most Supabase-specific code in   │
 * │ the app and WILL need rewriting for Oracle.                             │
 * │                                                                         │
 * │ Two parts have to change together:                                      │
 * │   1. The identity delete (auth.admin.deleteUser) has no Oracle analogue.│
 * │      Under UAB SSO the institution owns the account — we will almost    │
 * │      certainly not be allowed to delete it at all, and this becomes     │
 * │      "delete the user's DATA and detach the identity" instead.          │
 * │   2. The row cascade below relies on Postgres FKs declared              │
 * │      ON DELETE CASCADE from auth.users. A different identity store      │
 * │      means those FKs no longer point anywhere, so the explicit deletes  │
 * │      here become the ONLY cleanup and must be exhaustive.               │
 * │                                                                         │
 * │ Everything is here on purpose. No page, action or route contains any    │
 * │ part of this cascade.                                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Confirmation is by typed email rather than password. That is deliberate:
 * under SSO there is no local password to re-verify, so a password prompt would
 * be one more thing to tear out. The typed value is compared to the SESSION's
 * email, server-side — a caller cannot nominate someone else's account.
 */
export async function deleteAccount(confirmEmail: string): Promise<AuthOutcome> {
  const { db: sessionDb, user } = await requireCurrentUser();

  const typed = confirmEmail.trim().toLowerCase();
  const actual = (user.email ?? "").trim().toLowerCase();
  if (!actual || typed !== actual) {
    return { ok: false, error: "That doesn't match the email on this account." };
  }

  const admin = getServiceRoleClient();
  if (!admin) throw new ServerConfigError("Account deletion is not configured.");

  const userId = user.id;

  // Explicit cascade. Most of these FKs are already ON DELETE CASCADE from
  // auth.users, so deleteUser alone would clear them — they are listed anyway so
  // the full blast radius is readable in one place, and so the cleanup still
  // works if a cascade is ever dropped or the identity store changes (see the
  // migration box above). Order: children before parents.
  const owned: Array<[table: string, column: string]> = [
    ["comments", "user_id"],
    ["researcher_works", "user_id"],
    ["saved_items", "user_id"],
    ["connection_requests", "user_id"],
    ["collab_posts", "owner_id"],
    ["promote_showcase", "owner_id"],
    ["lab_resources", "owner_id"],
    ["users", "id"],
  ];

  try {
    for (const [table, column] of owned) {
      const { error } = await admin.from(table).delete().eq(column, userId);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) throw new Error(`auth user: ${authErr.message}`);
  } catch (e) {
    // Never leak raw Postgres/Supabase detail to the client.
    console.error("deleteAccount failed", e);
    return {
      ok: false,
      error: "Something went wrong deleting your account. Please contact support.",
    };
  }

  // Clear the now-orphaned session cookies so the browser isn't left holding a
  // token for a user that no longer exists.
  await sessionDb.auth.signOut().catch(() => {});

  return { ok: true };
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
