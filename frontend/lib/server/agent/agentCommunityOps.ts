// lib/server/agent/agentCommunityOps.ts — the real community operations behind
// the agent's search_communities / join_community / create_community tools.
// Every call uses the researcher's own token-bound client (`db`), so row-level
// security decides what is allowed: a join inserts only the caller's own row
// (policy "Community members: self insert": active only for an open community,
// pending only for a closed one) and a create goes through
// create_community_with_admin, which makes the caller the admin. The site's
// own flows (joinCommunity, createCommunity in lib/server/communities.ts) use
// the cookie session; these are the same operations for a bearer-token caller.

import { MATCH_MIN_COVERAGE, rankCommunities, type RankableCommunity } from "@/lib/server/assistant/communityMatch";
import type { CommunityOps } from "./agentHandlers";

type Row = RankableCommunity & { id: string; slug: string; is_open: boolean };

export const realCommunityOps: CommunityOps = {
  async search(db, query, limit) {
    const [list, counts] = await Promise.all([
      db.from("communities").select("id, slug, name, description, is_open, explore_topics"),
      db.rpc("community_member_counts"),
    ]);
    if (list.error || !Array.isArray(list.data)) throw list.error ?? new Error("communities unavailable");
    const countOf = new Map<string, number>(
      ((counts.data ?? []) as { community_id: string; member_count: number | string }[]).map((r) => [
        r.community_id,
        Number(r.member_count) || 0,
      ])
    );
    const rows = (list.data as Row[]).map((r) => ({ ...r, explore_topics: r.explore_topics ?? [] }));
    return rankCommunities(query, rows, { minCoverage: MATCH_MIN_COVERAGE, limit }).map(({ community: c, matched }) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      purpose: c.description,
      memberCount: countOf.get(c.id) ?? 0,
      isOpen: c.is_open,
      why: matched,
    }));
  },

  async find(db, slug) {
    const { data, error } = await db.from("communities").select("id, slug, name, is_open").eq("slug", slug).maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, slug: data.slug, name: data.name, isOpen: !!data.is_open } : null;
  },

  async membership(db, userId, communityId) {
    const { data, error } = await db
      .from("community_members")
      .select("status")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.status === "active" ? "active" : data?.status === "pending" ? "pending" : null;
  },

  async join(db, user, community) {
    const status = community.isOpen ? "active" : "pending";
    const { error } = await db.from("community_members").insert({
      community_id: community.id,
      user_id: user.id,
      email: user.email,
      status,
    });
    if (error) {
      // 23505: an admin already added this email; link that row to this account.
      if (error.code === "23505") {
        const claim = await db.rpc("claim_pending_community_memberships");
        if (!claim.error) return { ok: true, status: "active" };
      }
      console.error("agent join_community failed", error);
      return { ok: false, error: "Couldn't join that community." };
    }
    return { ok: true, status };
  },

  async create(db, name, purpose) {
    const { data, error } = await db.rpc("create_community_with_admin", { p_name: name, p_description: purpose }).single();
    if (error || !data) {
      console.error("agent create_community failed", error);
      return { ok: false, error: "Couldn't create the community." };
    }
    const row = data as { id: string; slug: string };
    return { ok: true, id: row.id, slug: row.slug };
  },
};
