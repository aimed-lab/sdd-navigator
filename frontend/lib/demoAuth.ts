// Client-side storage for the sandbox-only demo session (see
// app/auth/demoActions.ts). Holds no token: it only makes the shell UI render
// as signed in, and grants nothing on the server.
import type { Session, User } from "@supabase/supabase-js";

const KEY = "sdd-demo-session";

export const DEMO_USER = {
  id: "00000000-0000-0000-0000-00000000demo",
  email: "demo@sandbox.local",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: { name: "Demo User (dev only)" },
  created_at: new Date(0).toISOString(),
} as User;

export const isDemoSession = () =>
  typeof window !== "undefined" && localStorage.getItem(KEY) === "1";

export const startDemoSession = () => localStorage.setItem(KEY, "1");
export const endDemoSession = () => localStorage.removeItem(KEY);

export const demoSession = () => ({ user: DEMO_USER }) as Session;
