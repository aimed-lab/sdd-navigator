"use server";

// Server Actions for the Service Providers directory: request a quote, claim a
// page, list your services. Thin: validate, save as the signed-in user, report.
// Signed out fails here too (the UI gate is only a convenience), and RLS checks
// it again in the database. No email is sent yet.

import { UnauthorizedError } from "@/lib/auth";
import { getProviderBySlug } from "@/lib/server/providers/providers";
import { parseClaim, parseProviderRequest, parseQuote } from "@/lib/server/providers/validate";
import { createClaim, createProviderRequest, createQuoteRequest } from "@/lib/server/providers/store";

export type ProviderActionResult = { ok: true; message: string } | { ok: false; error: string };

function failure(e: unknown, signInText: string, label: string): ProviderActionResult {
  if (e instanceof UnauthorizedError) return { ok: false, error: signInText };
  console.error(label, e);
  return { ok: false, error: "Couldn't send that. Please try again." };
}

export async function requestQuoteAction(slug: string, input: unknown): Promise<ProviderActionResult> {
  const provider = getProviderBySlug(String(slug ?? ""));
  if (!provider) return { ok: false, error: "That provider doesn't exist." };
  const parsed = parseQuote(input);
  if (!parsed.ok) return parsed;
  try {
    await createQuoteRequest(provider.slug, parsed.value);
    return { ok: true, message: `Request sent. The SPARC team will connect you with ${provider.name}.` };
  } catch (e) {
    return failure(e, "Sign in to request a quote.", "requestQuoteAction failed");
  }
}

export async function claimPageAction(slug: string, input: unknown): Promise<ProviderActionResult> {
  const provider = getProviderBySlug(String(slug ?? ""));
  if (!provider) return { ok: false, error: "That provider doesn't exist." };
  const parsed = parseClaim(input);
  if (!parsed.ok) return parsed;
  try {
    await createClaim(provider.slug, parsed.value);
    return { ok: true, message: "Thanks, we'll verify and get back to you." };
  } catch (e) {
    return failure(e, "Sign in to claim this page.", "claimPageAction failed");
  }
}

export async function listServicesAction(input: unknown): Promise<ProviderActionResult> {
  const parsed = parseProviderRequest(input);
  if (!parsed.ok) return parsed;
  try {
    await createProviderRequest(parsed.value);
    return { ok: true, message: "Thanks, we've got it. The SPARC team will be in touch." };
  } catch (e) {
    return failure(e, "Sign in to list your services.", "listServicesAction failed");
  }
}
