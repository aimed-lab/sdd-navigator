import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Session-scoped Supabase client for Route Handlers. Built from the caller's
// auth cookies so every query runs as THAT user — Row Level Security then
// enforces ownership at the database level (a user can only ever read/write
// their own rows). Never use a client-supplied user id; always derive identity
// from getUser() on the client this returns.
//
// Returns null when the Supabase env vars are missing so callers can fail
// cleanly with a 500 instead of throwing.
export async function getRouteClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Route handler responses don't always allow cookie writes — safe to ignore.
        }
      },
    },
  });
}
