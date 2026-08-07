"use client";

// lib/authClient.ts — THE CLIENT-SIDE HALF OF THE AUTH SEAM.
//
// lib/auth.ts is server-only (it reads cookies via next/headers), so a
// client component can never import it directly — that's why
// context/AuthContext.tsx used to import `supabase` from lib/supabase.ts and
// call `.auth.getSession()` / `.auth.onAuthStateChange()` on it itself. That
// made AuthContext a second, independent call site for the Supabase SDK,
// outside the seam.
//
// This file is the fix: the ONLY place in a client component that touches
// `@supabase/*` for session state. AuthContext.tsx (and anything else that
// needs to read the client-side session) goes through here instead. Under a
// future provider swap, this file plus lib/auth.ts are the only two that
// change — no consumer of AuthContext/useAuth is affected either way.
//
// READ-ONLY, same as AuthContext's own contract: session WRITES (sign in,
// sign up, sign out, SSO redirect) still go through Server Actions into
// lib/auth.ts, never through here. This just mirrors the cookie session the
// server actions already wrote, so the Nav etc. update without a reload.

import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** The current client-visible session, or null when signed out. */
export async function getClientSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Subscribe to session changes (sign-in, sign-out, token refresh). Returns
 *  an unsubscribe function. */
export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}
