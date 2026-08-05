"use server";

// Server Actions for /projects. Same pattern as app/collaborate/actions.ts:
// the client never sees a token and cannot supply lead_id/owner_id — that
// comes from the session inside lib/server/projects.ts.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import { createProject } from "@/lib/server/projects";
import {
  COLABOFEST_CHALLENGE_KEY,
  MODALITIES,
  PROJECT_STAGES,
  type Modality,
  type ProjectStage,
} from "@/lib/projectTypes";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

function asModality(v: unknown): Modality | null {
  return typeof v === "string" && (MODALITIES as readonly string[]).includes(v)
    ? (v as Modality)
    : null;
}

function asStage(v: unknown): ProjectStage | null {
  return typeof v === "string" && (PROJECT_STAGES as readonly string[]).includes(v)
    ? (v as ProjectStage)
    : null;
}

/** Create a project as the signed-in user. `colabofest` is a plain boolean
 *  from the form's entry point (the ColaboFest banner vs. plain "New
 *  project") — this is the ONE place a caller-supplied flag turns into the
 *  real challenge_key string, so a forged request can only ever set the one
 *  real value this UI knows about, never an arbitrary string. */
export async function createProjectAction(input: {
  name: string;
  description: string;
  deadline?: string;
  colabofest?: boolean;
  challenge?: string; // from the "Entering a challenge?" select, non-ColaboFest entry point
  target?: string;
  indication?: string;
  modality?: string;
  stage?: string;
}): Promise<ActionResult> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "A project name is required." };

  const description = (input.description ?? "").trim();
  if (!description) return { ok: false, error: "Tell us what you're working on." };

  const challenge_key = input.colabofest
    ? COLABOFEST_CHALLENGE_KEY
    : input.challenge === "colabofest2026"
      ? COLABOFEST_CHALLENGE_KEY
      : null;

  try {
    const result = await createProject({
      name,
      description,
      deadline: input.deadline || null,
      challenge_key,
      target: input.target || null,
      indication: input.indication || null,
      modality: asModality(input.modality),
      stage: asStage(input.stage),
    });

    if (result.status !== "ok") {
      return { ok: false, error: result.error };
    }

    revalidatePath("/projects");
    return { ok: true, id: result.id };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to create a project." };
    }
    console.error("createProjectAction failed", e);
    return { ok: false, error: "Couldn't create the project. Please try again." };
  }
}
