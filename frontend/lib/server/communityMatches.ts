// lib/server/communityMatches.ts — the assistant's "check before creating"
// step for communities: the top matches for a topic, shaped for match cards.
// Everything here is a read; joining and creating go through the existing
// actions (joinCommunityAction, createCommunityAction).

import { getCurrentUser } from "@/lib/auth";
import { listMemberRoster, listMyMemberships, searchCommunityMatches } from "@/lib/server/communities";
import { viewerAccess } from "@/lib/server/communityHome/communityHome";
import type { CommunityMatch } from "@/lib/server/assistant/communityMatch";

export async function matchCommunitiesForViewer(query: string): Promise<{ signedIn: boolean; matches: CommunityMatch[] }> {
  const [user, ranked, memberships] = await Promise.all([
    getCurrentUser(),
    searchCommunityMatches(query),
    listMyMemberships(),
  ]);

  const matches = await Promise.all(
    ranked.map(async ({ community: c, matched }): Promise<CommunityMatch> => {
      const m = memberships[c.id];
      const state: CommunityMatch["state"] = !user
        ? "signed_out"
        : m?.status === "active"
          ? "active"
          : m?.status === "pending"
            ? "pending"
            : "none";

      // "Run by <admin>" only when this viewer may see the roster: a member, or
      // a community whose public preview is 'open'. The roster RPC enforces the
      // same rule; this just avoids asking when the answer is no.
      let runBy: string | null = null;
      if (viewerAccess({ isMember: state === "active", publicPreview: c.public_preview }).seesMembers) {
        const roster = await listMemberRoster(c.id);
        runBy = roster.find((r) => r.role === "admin" && !r.hidden)?.display_name ?? null;
      }

      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        purpose: c.description,
        memberCount: c.member_count ?? 0,
        isOpen: c.is_open,
        runBy,
        why: matched,
        state,
      };
    })
  );

  return { signedIn: !!user, matches };
}
