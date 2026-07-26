"use client";

// Client-side session MIRROR for the shell (Nav, comment box, any "are they
// signed in?" UI). Read-only by design.
//
// The split to keep in mind when SSO lands:
//   • OPERATIONS (sign in / up / out) belong to lib/auth.ts and run server-side.
//     signOut below delegates to logoutAction — it does not sign out locally.
//   • READING the current session is what this file does. It watches the cookie
//     session the server actions write, so the Nav updates without a reload
//     after onAuthStateChange fires.
//
// The Supabase import here is therefore a session *reader*, not an auth
// implementation. Under SSO this becomes "read the IdP session" and the
// consumers (useAuth) do not change.

import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { logoutAction } from "@/app/auth/actions";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setUser(next?.user ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Prefer the signup display name; fall back to the email prefix.
  const displayName =
    (user?.user_metadata?.name as string | undefined) ??
    user?.email?.split("@")[0] ??
    null;

  // Goes through the seam so the SERVER clears the session cookies — the same
  // cookies server components and RLS read. Clearing them only in the browser
  // would leave every server-rendered page still believing the user is signed
  // in until the cookie expired.
  //
  // Then a full navigation, for the same reason login uses one: it guarantees
  // every server component re-renders signed-out rather than trusting that each
  // one happened to be dynamic.
  const signOut = async () => {
    await logoutAction();
    window.location.assign("/");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, displayName, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>.");
  return ctx;
}
