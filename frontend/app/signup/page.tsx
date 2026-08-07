// Sign up — /signup.
//
// SSO handles registration: there is no separate signup form or step
// anymore. This route exists only because components/Nav.tsx and old links
// still point at /signup — it forwards straight to /login, which renders
// the single "Sign in with SmartDrugDiscovery" button that both signs in an
// existing SSO account and provisions a new one on first login (see
// handle_new_user in database/schema.sql). callbackUrl is preserved so the
// redirect still lands wherever the caller intended.
//
// SERVER component and a real redirect() (not client-side navigation) so a
// direct hit on /signup never renders a stale form, even for a moment.

import { redirect } from "next/navigation";
import { safeCallback } from "@/lib/safeRedirect";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const safe = callbackUrl ? safeCallback(callbackUrl, "") : "";
  redirect(safe ? `/login?callbackUrl=${encodeURIComponent(safe)}` : "/login");
}
