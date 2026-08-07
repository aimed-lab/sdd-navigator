import { NextResponse } from "next/server";
import { confirmEmailLink } from "@/lib/auth";
import { safeCallback } from "@/lib/safeRedirect";

// GET /auth/callback — SSO (SPARC Keycloak) return leg.
//
// signInWithSSO() (lib/auth.ts) sends the browser to Keycloak with
// redirectTo=<this route>?next=<where the user was headed>. Keycloak
// authenticates, Supabase's own /auth/v1/callback exchanges the OIDC
// response for a PKCE `code` and bounces the browser here with it. This
// route finishes the exchange — exactly the same exchangeCodeForSession()
// call the password-recovery flow uses in app/auth/confirm/route.ts, since
// PKCE code exchange doesn't care which flow produced the code.
//
// On success the session cookies are set by the seam and we redirect to
// ?next= (sanitised — it round-trips through the IdP, so it is untrusted
// input). On failure we send the user to /login with a flag, same pattern
// as /auth/confirm.

export const dynamic = "force-dynamic"; // depends on cookies + query

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeCallback(url.searchParams.get("next"));

  const result = await confirmEmailLink({ code: url.searchParams.get("code") });

  if (!result.ok) {
    return NextResponse.redirect(new URL("/login?sso=failed", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
