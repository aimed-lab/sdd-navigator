"use server";

// Sandbox-only demo sign-in gate. True only inside the Base44 preview sandbox
// (BASE44_PREVIEW_MODE === "1") on a dev server — never in production builds.
// The demo session is a client-side mirror only: it sets no auth cookies, so
// server components, RLS and the backend still treat the visitor as signed out.
export async function demoAuthEnabledAction(): Promise<boolean> {
  return process.env.BASE44_PREVIEW_MODE === "1" && process.env.NODE_ENV !== "production";
}
