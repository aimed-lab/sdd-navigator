"use server";

// Server Actions for /communities and /communities/[slug]. Same pattern as
// app/collaborate/actions.ts — every action goes through
// lib/server/communities.ts, which goes through lib/auth.ts, never
// @supabase directly. Ordered so the demo path (create a community, add a
// member by email, see it in the list) is at the top; admin-panel/roles
// actions follow.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  addCommunityMemberByEmail,
  approveMembership,
  changeCommunityMemberRole,
  createAnnouncement,
  createCommunity,
  createCommunityResource,
  deleteAnnouncement,
  deleteCommunity,
  deleteCommunityResource,
  joinCommunity,
  leaveCommunity,
  rejectMembership,
  removeCommunityMember,
  updateAnnouncement,
  updateCommunityResource,
  updateCommunitySections,
  type CommunityRole,
} from "@/lib/server/communities";
import type { SectionConfig } from "@/lib/communityTypes";

export type ActionResult = { ok: true; slug: string } | { ok: false; error: string };
export type SimpleActionResult = { ok: true } | { ok: false; error: string };

// ── demo path ────────────────────────────────────────────────────────────

/** Create a community. Any signed-in user; always private; creator becomes
 *  admin — all enforced by create_community_with_admin (RPC), not here. */
export async function createCommunityAction(input: {
  name: string;
  purpose: string;
}): Promise<ActionResult> {
  try {
    const result = await createCommunity(input);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath("/communities");
    return { ok: true, slug: result.slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to create a community." };
    }
    console.error("createCommunityAction failed", e);
    return { ok: false, error: "Couldn't create the community. Please try again." };
  }
}

/** Add a member directly by email. Admin-only — see
 *  addCommunityMemberByEmail's own comment for the two-way-in and
 *  link-now-or-at-signup behavior. */
export async function addCommunityMemberByEmailAction(
  communityId: string,
  slug: string,
  email: string
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    const result = await addCommunityMemberByEmail(communityId, email);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("addCommunityMemberByEmailAction failed", e);
    return { ok: false, error: "Couldn't add that member. Please try again." };
  }
}

// ── request/leave (reuses the existing /collaborate flow's own functions) ──

export async function joinCommunityAction(
  communityId: string,
  isOpen: boolean,
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    await joinCommunity(communityId, isOpen);
    revalidatePath(`/communities/${slug}`);
    revalidatePath("/communities");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to request to join." };
    }
    console.error("joinCommunityAction failed", e);
    return { ok: false, error: "Couldn't do that. Please try again." };
  }
}

export async function leaveCommunityAction(
  communityId: string,
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    const result = await leaveCommunity(communityId);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    revalidatePath("/communities");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("leaveCommunityAction failed", e);
    return { ok: false, error: "Couldn't do that. Please try again." };
  }
}

// ── admin panel ──────────────────────────────────────────────────────────

export async function approveMembershipAction(
  memberRowId: string,
  slug: string
): Promise<SimpleActionResult> {
  if (!memberRowId) return { ok: false, error: "Missing request." };

  try {
    await approveMembership(memberRowId);
    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("approveMembershipAction failed", e);
    return { ok: false, error: "Couldn't approve that. Please try again." };
  }
}

export async function rejectMembershipAction(
  memberRowId: string,
  slug: string
): Promise<SimpleActionResult> {
  if (!memberRowId) return { ok: false, error: "Missing request." };

  try {
    await rejectMembership(memberRowId);
    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("rejectMembershipAction failed", e);
    return { ok: false, error: "Couldn't reject that. Please try again." };
  }
}

// ── roles ────────────────────────────────────────────────────────────────

export async function changeCommunityMemberRoleAction(
  communityId: string,
  memberRowId: string,
  role: CommunityRole,
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId || !memberRowId) return { ok: false, error: "Missing member." };

  try {
    const result = await changeCommunityMemberRole(communityId, memberRowId, role);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("changeCommunityMemberRoleAction failed", e);
    return { ok: false, error: "Couldn't change that member's role. Please try again." };
  }
}

export async function removeCommunityMemberAction(
  communityId: string,
  memberRowId: string,
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId || !memberRowId) return { ok: false, error: "Missing member." };

  try {
    const result = await removeCommunityMember(communityId, memberRowId);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("removeCommunityMemberAction failed", e);
    return { ok: false, error: "Couldn't remove that member. Please try again." };
  }
}

/** Delete a community. Admin-only — see deleteCommunity's own comment on
 *  what survives (its projects, set back to personal) vs. what's gone for
 *  good (the community row and every membership row, cascaded). No
 *  revalidatePath for the deleted page itself — the caller (
 *  DeleteCommunityButton) navigates away from /communities/[slug]
 *  immediately on success, same as deleteProjectAction. */
export async function deleteCommunityAction(communityId: string): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    const result = await deleteCommunity(communityId);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath("/communities");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("deleteCommunityAction failed", e);
    return { ok: false, error: "Couldn't delete the community. Please try again." };
  }
}

// ── announcements ────────────────────────────────────────────────────────

/** Post an announcement. Admin-only — see createAnnouncement's own comment
 *  on the RLS gate and where author_id comes from. */
export async function createAnnouncementAction(
  communityId: string,
  slug: string,
  input: { title: string; body: string }
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    const result = await createAnnouncement(communityId, input);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("createAnnouncementAction failed", e);
    return { ok: false, error: "Couldn't post the announcement. Please try again." };
  }
}

/** Edit an announcement. Admin-only — "Community announcements: admin
 *  update" (RLS) is the real gate. */
export async function updateAnnouncementAction(
  communityId: string,
  announcementId: string,
  slug: string,
  input: { title: string; body: string }
): Promise<SimpleActionResult> {
  if (!communityId || !announcementId) return { ok: false, error: "Missing announcement." };

  try {
    const result = await updateAnnouncement(communityId, announcementId, input);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("updateAnnouncementAction failed", e);
    return { ok: false, error: "Couldn't save the announcement. Please try again." };
  }
}

/** Delete an announcement. Admin-only — "Community announcements: admin
 *  delete" (RLS) is the real gate. */
export async function deleteAnnouncementAction(
  communityId: string,
  announcementId: string,
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId || !announcementId) return { ok: false, error: "Missing announcement." };

  try {
    const result = await deleteAnnouncement(communityId, announcementId);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("deleteAnnouncementAction failed", e);
    return { ok: false, error: "Couldn't delete the announcement. Please try again." };
  }
}

// ── resources ────────────────────────────────────────────────────────────

/** Add a resource. Admin-only — see createCommunityResource's own comment
 *  on the RLS gate and where added_by comes from. */
export async function createCommunityResourceAction(
  communityId: string,
  slug: string,
  input: { title: string; resource_type: string; url: string; description: string }
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    const result = await createCommunityResource(communityId, input);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("createCommunityResourceAction failed", e);
    return { ok: false, error: "Couldn't add the resource. Please try again." };
  }
}

/** Edit a resource. Admin-only — "Community resources: admin update" (RLS)
 *  is the real gate. */
export async function updateCommunityResourceAction(
  communityId: string,
  resourceId: string,
  slug: string,
  input: { title: string; resource_type: string; url: string; description: string }
): Promise<SimpleActionResult> {
  if (!communityId || !resourceId) return { ok: false, error: "Missing resource." };

  try {
    const result = await updateCommunityResource(communityId, resourceId, input);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("updateCommunityResourceAction failed", e);
    return { ok: false, error: "Couldn't save the resource. Please try again." };
  }
}

/** Delete a resource. Admin-only — "Community resources: admin delete"
 *  (RLS) is the real gate. */
export async function deleteCommunityResourceAction(
  communityId: string,
  resourceId: string,
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId || !resourceId) return { ok: false, error: "Missing resource." };

  try {
    const result = await deleteCommunityResource(communityId, resourceId);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("deleteCommunityResourceAction failed", e);
    return { ok: false, error: "Couldn't delete the resource. Please try again." };
  }
}

/** Save the community's section list. Admin-only — see
 *  updateCommunitySections's own comment: writes the whole array every
 *  time, no diffing. */
export async function updateCommunitySectionsAction(
  communityId: string,
  sections: SectionConfig[],
  slug: string
): Promise<SimpleActionResult> {
  if (!communityId) return { ok: false, error: "Missing community." };

  try {
    const result = await updateCommunitySections(communityId, sections);
    if (result.status !== "ok") return { ok: false, error: result.error };

    revalidatePath(`/communities/${slug}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in first." };
    }
    console.error("updateCommunitySectionsAction failed", e);
    return { ok: false, error: "Couldn't save sections. Please try again." };
  }
}
