// lib/safeRedirect.ts — post-auth redirect sanitisation, shared by server
// actions and the "use client" auth pages.
//
// Dependency-free by design, same reason as lib/collabTypes.ts and
// lib/showcaseTypes.ts: both sides need the VALUE, and importing it from a
// server module would drag next/headers into the client bundle.
//
// WHY IT EXISTS AT ALL: ?callbackUrl= is attacker-controlled. Without this, a
// link like /login?callbackUrl=https://evil.example bounces a user who has just
// authenticated straight off-site — a textbook open redirect, and a convincing
// one precisely because the login it followed was genuine.

/** Accept only same-origin relative paths. Everything else falls back. */
export function safeCallback(raw: unknown, fallback = "/explore"): string {
  if (typeof raw !== "string" || !raw) return fallback;
  if (!raw.startsWith("/")) return fallback; // absolute URL, or garbage
  if (raw.startsWith("//")) return fallback; // protocol-relative → off-site
  if (raw.startsWith("/\\")) return fallback; // backslash trick some parsers accept
  return raw;
}
