// Service Providers directory: every database read/write. Server only.
//
// All of it goes through the session client (lib/auth.ts), so row-level
// security is the real gate: signed-in users insert their own rows, only site
// admins read everything, and nobody reads these tables publicly. No
// service-role client is used here.

import { getDb, getSession, requireCurrentUser } from "@/lib/auth";
import { isSiteAdmin } from "@/lib/server/showcase";
import type { ProviderEventRow } from "./core.ts";
import type { ClaimInput, ProviderRequestInput, QuoteInput } from "./validate.ts";

export type EventName = "website_click" | "profile_view";

/** Record one event. Best effort: a logging failure never breaks the page or the
 *  redirect. Stores the slug, the event, the user id when signed in, and the
 *  referring PATH only (no query, no host). */
export async function logProviderEvent(slug: string, event: EventName, referrer: string): Promise<void> {
  try {
    const session = await getSession();
    const db = session?.db ?? (await getDb());
    if (!db) return;
    // No .select(): there is no public read policy, and RETURNING would need one.
    const { error } = await db.from("provider_events").insert({
      slug,
      event,
      user_id: session?.user.id ?? null,
      referrer: referrer.slice(0, 200),
    });
    if (error) console.error("provider event not logged", event, slug, error.message);
  } catch (e) {
    console.error("provider event not logged", event, slug, e);
  }
}

/** Is someone signed in? (the page shows sign-in prompts otherwise) */
export async function currentUserName(): Promise<{ signedIn: boolean; name: string; email: string }> {
  const session = await getSession();
  if (!session) return { signedIn: false, name: "", email: "" };
  const { data } = await session.db.from("users").select("name").eq("id", session.user.id).maybeSingle();
  return { signedIn: true, name: String(data?.name ?? ""), email: session.user.email ?? "" };
}

export async function createQuoteRequest(slug: string, q: QuoteInput): Promise<void> {
  const { user, db } = await requireCurrentUser();
  const { data } = await db.from("users").select("name").eq("id", user.id).maybeSingle();
  const email = user.email ?? "";
  const name = String(data?.name ?? "").trim() || email.split("@")[0] || "Member";
  const { error } = await db.from("provider_quote_requests").insert({
    slug,
    user_id: user.id,
    name: name.slice(0, 120),
    email: email.slice(0, 200),
    need: q.need,
    timeline: q.timeline,
    budget: q.budget,
    message: q.message,
    status: "new",
  });
  if (error) throw error;
}

export async function createClaim(slug: string, c: ClaimInput): Promise<void> {
  const { user, db } = await requireCurrentUser();
  const { error } = await db.from("provider_claims").insert({
    slug,
    user_id: user.id,
    name: c.name,
    role: c.role,
    work_email: c.work_email,
    note: c.note,
    status: "pending",
  });
  if (error) throw error;
}

export async function createProviderRequest(r: ProviderRequestInput): Promise<void> {
  const { user, db } = await requireCurrentUser();
  const { error } = await db.from("provider_requests").insert({
    user_id: user.id,
    company: r.company,
    website: r.website,
    contact_name: r.contact_name,
    email: r.email,
    offer: r.offer,
    status: "new",
  });
  if (error) throw error;
}

// ── admin ────────────────────────────────────────────────────────────────────

export type AdminQuote = {
  id: string;
  slug: string;
  name: string;
  email: string;
  need: string;
  timeline: string;
  budget: string;
  message: string;
  status: string;
  created_at: string;
};
export type AdminClaim = {
  id: string;
  slug: string;
  name: string;
  role: string;
  work_email: string;
  note: string;
  status: string;
  created_at: string;
};
export type AdminRequest = {
  id: string;
  company: string;
  website: string;
  contact_name: string;
  email: string;
  offer: string;
  status: string;
  created_at: string;
};

export type AdminData = {
  quotes: AdminQuote[];
  claims: AdminClaim[];
  requests: AdminRequest[];
  events: ProviderEventRow[];
};

/** Everything the admin view shows, or null when the caller is not a site
 *  admin. (RLS returns no rows to anyone else anyway.) */
export async function loadAdminData(days = 30): Promise<AdminData | null> {
  if (!(await isSiteAdmin())) return null;
  const db = await getDb();
  if (!db) return null;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [quotes, claims, requests, events] = await Promise.all([
    db
      .from("provider_quote_requests")
      .select("id, slug, name, email, need, timeline, budget, message, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("provider_claims")
      .select("id, slug, name, role, work_email, note, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("provider_requests")
      .select("id, company, website, contact_name, email, offer, status, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("provider_events")
      .select("slug, event, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50000),
  ]);
  for (const r of [quotes, claims, requests, events]) if (r.error) throw r.error;

  return {
    quotes: (quotes.data ?? []) as AdminQuote[],
    claims: (claims.data ?? []) as AdminClaim[],
    requests: (requests.data ?? []) as AdminRequest[],
    events: (events.data ?? []) as ProviderEventRow[],
  };
}
