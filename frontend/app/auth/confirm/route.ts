import { NextResponse } from "next/server";
import { confirmEmailLink } from "@/lib/auth";
import { safeCallback } from "@/lib/safeRedirect";

// GET /auth/confirm — where the emailed confirmation link lands.
//
// Email confirmation is ON for this Supabase project (mailer_autoconfirm =
// false), so signUp() creates the auth user WITHOUT a session and the account is
// inert until this route runs. That makes this route load-bearing, not
// decorative: without it a new user can never reach a signed-in state.
//
// The link may arrive in either of two shapes depending on the project's email
// template, so lib/auth.ts handles both:
//   ?code=<uuid>                    PKCE  → exchangeCodeForSession
//   ?token_hash=<hash>&type=signup  hash  → verifyOtp
//
// On success the session cookies are set by the seam and we redirect to ?next=
// (sanitised — it round-trips through an email, so it is untrusted input).
// On failure we send the user to /login with a flag rather than rendering an
// error here, so there is exactly one page in the app that talks about signing
// in.

export const dynamic = "force-dynamic"; // depends on cookies + query

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeCallback(url.searchParams.get("next"));

  const result = await confirmEmailLink({
    code: url.searchParams.get("code"),
    tokenHash: url.searchParams.get("token_hash"),
    type: url.searchParams.get("type"),
  });

  if (!result.ok) {
    return NextResponse.redirect(new URL("/login?confirmed=failed", url.origin));
  }

  // Confirmed AND signed in — go straight where they were headed.
  return NextResponse.redirect(new URL(next, url.origin));
}
