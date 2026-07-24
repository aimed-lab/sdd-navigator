import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getRouteClient } from "@/lib/supabaseRoute";

// =============================================================================
// lib/server — single entry point for server-side Supabase access.
// =============================================================================
// Two clients, two trust levels. Every lib/server module MUST get its client
// from here so the RLS/session model stays consistent across the codebase.
//
//   • getSessionClient()  — user-scoped, cookie-based, RLS-enforcing. This is a
//                           re-export of the SAME getRouteClient() the projects
//                           API already uses (consolidated, not duplicated).
//                           Use for anything user-owned; uid is always derived
//                           from getUser() on the returned client, never passed
//                           in from the caller.
//   • getAnonServerClient() — anon key, no session/cookies. Public-read RLS only
//                           (wiki, graph, public researcher profiles). NEVER use
//                           it for user-scoped reads/writes.
//
// Both return null when the required env vars are missing so callers can fail
// cleanly with a 500 rather than throwing at construction.
// =============================================================================

// Session-scoped client (cookie-based, RLS). Consolidated re-export of the
// existing route-handler client — one source of truth for "act as this user".
export const getSessionClient = getRouteClient;

// Anon server client for PUBLIC reads only. No persisted session; relies on
// public-read RLS. Do not use for user-owned data.
export function getAnonServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// =============================================================================
// Auth for user-scoped lib/server modules.
// =============================================================================
// Thrown when the Supabase env vars are missing (the client can't be built).
export class ServerConfigError extends Error {
  constructor(message = "Server misconfigured.") {
    super(message);
    this.name = "ServerConfigError";
  }
}

// Thrown when there is no valid signed-in session on the request.
export class UnauthorizedError extends Error {
  constructor(message = "You must be signed in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

// requireUser — the single gateway every user-owned lib/server op goes through.
// Builds the SESSION client from the caller's cookies and validates the JWT via
// getUser(). Returns the authenticated user together with its client, so the
// uid used in queries is ALWAYS derived here from the validated session, never
// passed in by a caller or read from a request body. RLS then enforces
// ownership at the database level on top of that.
export async function requireUser() {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();

  return { supabase, user };
}

// Maps a lib/server error to a JSON route response with the right status code.
// Keeps the auth/config → HTTP mapping in one place so the thin route handlers
// stay uniform.
export function errorResponse(e: unknown, fallback: string) {
  if (e instanceof UnauthorizedError) {
    return NextResponse.json({ error: e.message }, { status: 401 });
  }
  if (e instanceof ServerConfigError) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  console.error(fallback, e);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
