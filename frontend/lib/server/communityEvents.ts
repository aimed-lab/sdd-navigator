// lib/server/communityEvents.ts: a community's events. Everything goes through the
// caller's own session, so row-level security is the gate
// (2026-11-03_community_events.sql): active members read, admins add, change and
// delete. The checks here give clear messages; the rules live in the database.

import { unstable_noStore as noStore } from "next/cache";
import { getSession, requireCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/server/communities";
import { parseEventInput } from "@/lib/server/communityHome/tiles";

export type CommunityEvent = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  link: string | null;
  description: string | null;
  created_at: string;
};

export type EventWriteResult = { status: "ok" } | { status: "forbidden"; error: string } | { status: "error"; error: string };

const COLUMNS = "id, title, starts_at, location, link, description, created_at";

/** All of a community's events, soonest first. Members only (RLS): anyone else gets []. */
export async function listCommunityEvents(communityId: string): Promise<CommunityEvent[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await session.db
    .from("community_events")
    .select(COLUMNS)
    .eq("community_id", communityId)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error || !data) {
    if (error) console.error("listCommunityEvents failed", error);
    return [];
  }
  return data as CommunityEvent[];
}

const ADMINS_ONLY = "Only a community admin can add or change events.";

export async function createCommunityEvent(communityId: string, input: Parameters<typeof parseEventInput>[0]): Promise<EventWriteResult> {
  const { user, db } = await requireCurrentUser();
  if (!(await getMembership(communityId)).isAdmin) return { status: "forbidden", error: ADMINS_ONLY };
  const parsed = parseEventInput(input);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  // No RETURNING: the page re-reads the list afterwards.
  const { error } = await db.from("community_events").insert({
    id: globalThis.crypto.randomUUID(),
    community_id: communityId,
    created_by: user.id,
    ...parsed.value,
  });
  if (error) {
    if ((error as { code?: string }).code === "42501") return { status: "forbidden", error: ADMINS_ONLY };
    console.error("createCommunityEvent failed", error);
    return { status: "error", error: "Couldn't add the event. Please try again." };
  }
  return { status: "ok" };
}

export async function updateCommunityEvent(
  communityId: string,
  eventId: string,
  input: Parameters<typeof parseEventInput>[0]
): Promise<EventWriteResult> {
  const { db } = await requireCurrentUser();
  if (!(await getMembership(communityId)).isAdmin) return { status: "forbidden", error: ADMINS_ONLY };
  const parsed = parseEventInput(input);
  if (!parsed.ok) return { status: "error", error: parsed.error };
  const { data, error } = await db
    .from("community_events")
    .update(parsed.value)
    .eq("id", eventId)
    .eq("community_id", communityId)
    .select("id");
  if (error) {
    console.error("updateCommunityEvent failed", error);
    return { status: "error", error: "Couldn't save the event. Please try again." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: ADMINS_ONLY };
  return { status: "ok" };
}

export async function deleteCommunityEvent(communityId: string, eventId: string): Promise<EventWriteResult> {
  const { db } = await requireCurrentUser();
  if (!(await getMembership(communityId)).isAdmin) return { status: "forbidden", error: ADMINS_ONLY };
  const { data, error } = await db
    .from("community_events")
    .delete()
    .eq("id", eventId)
    .eq("community_id", communityId)
    .select("id");
  if (error) {
    console.error("deleteCommunityEvent failed", error);
    return { status: "error", error: "Couldn't delete the event. Please try again." };
  }
  if (!data || data.length === 0) return { status: "forbidden", error: ADMINS_ONLY };
  return { status: "ok" };
}
