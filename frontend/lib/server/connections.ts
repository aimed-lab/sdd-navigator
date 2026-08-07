// lib/server/connections.ts — on-platform "Connect" request writes.
//
// A logged-in researcher clicks "Connect" on a provider card in their Navigator
// proposal; we capture the request into `connection_requests` so SPARC can
// respond THROUGH the platform later (the attribution/tracking mechanism). No
// email or external contact is exchanged or stored here.
//
// WRITE goes through requireCurrentUser() so the requester (user_id) is derived from the
// validated session, never from the caller. RLS (WITH CHECK auth.uid() = user_id)
// then guarantees a user can only file requests as themselves.

import { requireCurrentUser } from "@/lib/auth";

export type ConnectionRequestInput = {
  provider_name: string;          // e.g. "UAB SPARC" (from the card)
  capability?: string | null;     // the specific capability/service clicked
  project_id?: string | null;     // the saved proposal id, if available
  message?: string | null;        // optional researcher note
};

// Validate + normalize an untrusted body into a ConnectionRequestInput. Returns
// null when the one required field (provider_name) is missing, so the route can
// answer 400 without touching the DB.
export function parseConnectionInput(body: unknown): ConnectionRequestInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const provider_name = str(b.provider_name);
  if (!provider_name) return null;

  const capability = str(b.capability);
  const project_id = str(b.project_id);
  const message = typeof b.message === "string" ? b.message.trim() : "";

  return {
    provider_name,
    capability: capability || null,
    // Only accept a project_id that looks like a UUID; anything else → null so a
    // bad value can't break the (SET NULL) FK. Absent/blank is fine (unsaved).
    project_id: /^[0-9a-f-]{36}$/i.test(project_id) ? project_id : null,
    message: message || null,
  };
}

// Insert one connection request as the signed-in user. user_id comes from the
// validated session (requireCurrentUser), never the input. Returns the new row id.
export async function createConnectionRequest(input: ConnectionRequestInput): Promise<string> {
  const { db: supabase, user } = await requireCurrentUser();

  const { data, error } = await supabase
    .from("connection_requests")
    .insert({
      user_id: user.id,
      provider_name: input.provider_name,
      capability: input.capability ?? null,
      project_id: input.project_id ?? null,
      message: input.message ?? "",
      // status defaults to 'new' at the DB level.
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Insert returned no row.");
  return data.id as string;
}
