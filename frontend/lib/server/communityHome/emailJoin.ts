// lib/server/communityHome/emailJoin.ts — the rules around "Join with your
// email" on an open community, kept pure so `npm test` covers them: email
// validation, the per-IP rate limit, and how the database function's answer
// (join_open_community_by_email, 2026-10-23_community_email_join_checklist.sql)
// becomes a message. The database function is the real gate (open only, never
// admin, lowercased, duplicates ignored); this is the layer in front of it.
//
// No runtime imports.

/** Same pattern the SQL function applies (a test checks they match). */
export const EMAIL_PATTERN = String.raw`^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$`;
const EMAIL_RE = new RegExp(EMAIL_PATTERN);

/** One IP may try this many times per window. Generous on purpose: a whole
 *  room scanning a QR code at a talk often shares one public IP. */
export const EMAIL_JOIN_WINDOW_MS = 10 * 60 * 1000;
export const EMAIL_JOIN_MAX_PER_IP = 60;

export function normalizeJoinEmail(raw: unknown): { ok: true; email: string } | { ok: false; error: string } {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "Enter your email address." };
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "That doesn't look like an email address." };
  }
  return { ok: true, email };
}

export const JOINED_MESSAGE =
  "You're in. We'll email you updates; sign in any time with this email to see everything.";

export type EmailJoinResult =
  | { ok: true; message: string }
  | { ok: false; error: string; reason: "invalid" | "rate_limited" | "closed" | "error" };

type RpcAnswer = { data: unknown; error: unknown };

/** Runs one email join. `rpc` calls the database function; `limiter` is the
 *  process's rate limiter (createRateLimiter in lib/server/rateLimit.ts). */
export async function runEmailJoin(args: {
  communityId: string;
  email: unknown;
  ip: string;
  limiter: { limited(key: string): boolean };
  rpc: (communityId: string, email: string) => Promise<RpcAnswer>;
}): Promise<EmailJoinResult> {
  // Every attempt counts, valid or not.
  if (args.limiter.limited(`email-join:${args.ip}`)) {
    return { ok: false, reason: "rate_limited", error: "Too many attempts from this network. Please try again in a few minutes." };
  }

  const parsed = normalizeJoinEmail(args.email);
  if (!parsed.ok) return { ok: false, reason: "invalid", error: parsed.error };
  if (!args.communityId) return { ok: false, reason: "error", error: "Missing community." };

  let answer: RpcAnswer;
  try {
    answer = await args.rpc(args.communityId, parsed.email);
  } catch {
    return { ok: false, reason: "error", error: "Couldn't add you just now. Please try again." };
  }
  if (answer.error) {
    return { ok: false, reason: "error", error: "Couldn't add you just now. Please try again." };
  }

  switch (answer.data) {
    // 'already_member' reads exactly like 'joined', so this form cannot be
    // used to find out who is already in a community.
    case "joined":
    case "already_member":
      return { ok: true, message: JOINED_MESSAGE };
    case "not_open":
      return { ok: false, reason: "closed", error: "This community needs a request to join. Sign in to send one." };
    case "invalid_email":
      return { ok: false, reason: "invalid", error: "That doesn't look like an email address." };
    default:
      return { ok: false, reason: "error", error: "Couldn't add you just now. Please try again." };
  }
}
