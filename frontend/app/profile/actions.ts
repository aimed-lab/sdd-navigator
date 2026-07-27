"use server";

// Server Actions for the profile editor (onboarding + settings).
//
// Same bridge pattern as app/auth/actions.ts: lib/server/{profile,account,
// interests}.ts are server-only, so "use client" pages reach them through here
// and never import Supabase.
//
// SECURITY — WHITELISTED PATCHES.
// lib/server/profile.ts's updateProfile() writes its patch VERBATIM to the users
// row. That is fine when the patch is built server-side from known columns, and
// dangerous if a FormData is passed through unfiltered: a caller could then set
// any column on their row, including profile_slug (unique, routing) or interests
// (bypassing the interests path). Every action below therefore constructs an
// explicit object with named keys. Never spread untrusted input into a patch.
//
// Ownership needs no check here: each lib/server module derives the uid from the
// validated session via requireUser(), and RLS enforces it again in Postgres.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  getProfile,
  updateProfile,
  replaceResearcherWorks,
  type ResearcherWork,
} from "@/lib/server/profile";
import { getInterests, setInterests } from "@/lib/server/interests";

export type SaveResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = "Your session expired. Sign in again.";

/** Trim to a length cap, or null when empty — the users table stores NULL rather
 *  than "" for absent optional fields. */
function text(v: FormDataEntryValue | null, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Only http(s) URLs are stored — a javascript:/data: value must never reach an
 *  href on a public profile page. Same rule as lib/server/showcase.ts. */
function url(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let raw = v.trim();
  // Be forgiving about a pasted "linkedin.com/in/x" with no scheme.
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function tags(v: FormDataEntryValue | null, cap = 20): string[] {
  if (typeof v !== "string" || !v) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(
      parsed
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 60))
    )
  ).slice(0, cap);
}

// ── reads ────────────────────────────────────────────────────────────────────

export type ProfileView = {
  name: string;
  title: string;
  affiliation: string;
  bio: string;
  research_focus: string;
  linkedin_url: string;
  website_url: string;
  scholar_url: string;
  orcid_url: string;
  github_url: string;
  interests: string[];
  is_public: boolean;
  profile_slug: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function loadProfileAction(): Promise<
  { ok: true; profile: ProfileView } | { ok: false; error: string }
> {
  try {
    const { profile } = await getProfile();
    const p = profile ?? {};
    return {
      ok: true,
      profile: {
        name: str(p.name),
        title: str(p.title),
        affiliation: str(p.affiliation),
        bio: str(p.bio),
        research_focus: str(p.research_focus),
        linkedin_url: str(p.linkedin_url),
        website_url: str(p.website_url),
        scholar_url: str(p.scholar_url),
        orcid_url: str(p.orcid_url),
        github_url: str(p.github_url),
        interests: Array.isArray(p.interests) ? (p.interests as string[]) : [],
        is_public: p.is_public === true,
        profile_slug: typeof p.profile_slug === "string" ? p.profile_slug : null,
      },
    };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: SIGNED_OUT };
    console.error("loadProfileAction failed", e);
    return { ok: false, error: "Couldn't load your profile." };
  }
}

// ── writes ───────────────────────────────────────────────────────────────────

/** Columns this action may write, and how each is sanitised. */
const PROFILE_COLUMNS: Record<string, (v: FormDataEntryValue | null) => string | null> = {
  name: (v) => text(v, 120),
  title: (v) => text(v, 120),
  affiliation: (v) => text(v, 160),
  bio: (v) => text(v, 2000),
  research_focus: (v) => text(v, 400),
  linkedin_url: url,
  website_url: url,
  scholar_url: url,
  orcid_url: url,
  github_url: url,
};

/**
 * Save the editable profile fields. Explicit whitelist — see the WHITELISTED
 * PATCHES note at the top of this file.
 *
 * PARTIAL BY DESIGN: only columns actually PRESENT in the FormData are written.
 * The two callers submit different subsets (settings has no research_focus
 * field; onboarding only sends orcid_url when an ORCID was entered), and an
 * unconditional patch would write null for every absent field — silently
 * wiping data the user never touched just because they saved a different form.
 * An empty-but-present field still clears its column, which is what a user who
 * deleted the text expects.
 */
export async function saveProfileAction(form: FormData): Promise<SaveResult> {
  const patch: Record<string, string | null> = {};
  for (const [column, sanitise] of Object.entries(PROFILE_COLUMNS)) {
    if (form.has(column)) patch[column] = sanitise(form.get(column));
  }

  if (Object.keys(patch).length === 0) return { ok: true }; // nothing submitted

  try {
    await updateProfile(patch);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: SIGNED_OUT };
    console.error("saveProfileAction failed", e);
    return { ok: false, error: "Couldn't save your profile. Please try again." };
  }
}

export async function saveInterestsAction(next: string[]): Promise<SaveResult> {
  try {
    const clean = Array.from(
      new Set(
        (Array.isArray(next) ? next : [])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.slice(0, 60))
      )
    ).slice(0, 20);
    await setInterests(clean);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: SIGNED_OUT };
    console.error("saveInterestsAction failed", e);
    return { ok: false, error: "Couldn't save your interests." };
  }
}

export async function loadInterestsAction(): Promise<string[]> {
  try {
    return await getInterests();
  } catch {
    return [];
  }
}

/** Public/private toggle for the researcher profile. Separate from
 *  saveProfileAction because it is a single deliberate act with its own
 *  consequence (the profile becomes world-readable via the users public-read
 *  RLS policy), not one field among many. */
export async function setProfileVisibilityAction(isPublic: boolean): Promise<SaveResult> {
  try {
    await updateProfile({ is_public: isPublic === true });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: SIGNED_OUT };
    console.error("setProfileVisibilityAction failed", e);
    return { ok: false, error: "Couldn't change your profile visibility." };
  }
}

// ── onboarding ───────────────────────────────────────────────────────────────

/** One save for the whole onboarding form: profile fields, interests, and any
 *  publications pulled from ORCID. Single action so a half-finished profile
 *  can't result from one of three requests failing. */
export async function completeOnboardingAction(form: FormData): Promise<SaveResult> {
  const profileResult = await saveProfileAction(form);
  if (!profileResult.ok) return profileResult;

  const interests = tags(form.get("interests"));
  const interestsResult = await saveInterestsAction(interests);
  if (!interestsResult.ok) return interestsResult;

  // ORCID-imported publications, if the user ran an import and kept them.
  const worksRaw = form.get("works");
  if (typeof worksRaw === "string" && worksRaw) {
    try {
      const parsed = JSON.parse(worksRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const rows: ResearcherWork[] = parsed
          .filter((w) => w && typeof w.title === "string" && w.title.trim())
          .slice(0, 20)
          .map((w) => ({
            type: "publication",
            title: String(w.title).slice(0, 400),
            journal: typeof w.journal === "string" ? w.journal.slice(0, 200) : null,
            year: Number.isInteger(w.year) ? w.year : null,
            url: typeof w.url === "string" ? w.url.slice(0, 500) : null,
            description: null,
          }));
        if (rows.length > 0) await replaceResearcherWorks(rows);
      }
    } catch (e) {
      // A malformed works payload must not lose the profile the user just typed.
      console.error("completeOnboardingAction: works parse failed", e);
    }
  }

  revalidatePath("/settings");
  return { ok: true };
}
