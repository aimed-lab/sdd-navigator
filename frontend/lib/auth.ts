// =============================================================================
// lib/auth.ts — THE AUTH SEAM.
// =============================================================================
// Every Collaborate module gets its identity through this file and NEVER imports
// @supabase/* directly. That is the whole point of the file: it is the single
// place that knows Supabase is the identity provider.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ SWAP POINT — Oracle / UAB SSO migration                                   │
// │                                                                           │
// │ When identity moves off Supabase Auth, ONLY this file changes. Reimplement │
// │ the four functions below against the new provider and every caller keeps   │
// │ working, because callers depend on the AuthUser shape and on               │
// │ requireCurrentUser() throwing UnauthorizedError — not on Supabase.         │
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
