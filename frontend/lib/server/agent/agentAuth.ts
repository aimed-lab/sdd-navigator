// lib/server/agent/agentAuth.ts — turn the researcher's own Supabase access
// token into an acting context: the user, and a database client BOUND TO THAT
// TOKEN, so every query the tool runs is evaluated by row-level security as
// that researcher.
//
// The anon key is used only to build the client; the researcher's token is what
// authorizes requests. There is no service-role fallback anywhere in this file,
// and none must be added: an invalid or missing token is a 401, full stop.

import { createClient } from "@supabase/supabase-js";
import type { AgentContext } from "./agentCore.ts";

export async function authenticateToken(token: string): Promise<AgentContext | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("agent auth: Supabase URL or anon key is not configured");
    return null;
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // getUser(token) asks Supabase Auth to validate the token; nothing is
  // trusted from the token's contents locally.
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { user: { id: data.user.id, email: data.user.email ?? null }, db: client };
}
