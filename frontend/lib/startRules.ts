// lib/startRules.ts — small pure rules for the /start welcome page. No imports,
// so `npm test` runs it directly.

/** The first word of a person's name, or null. A name that is only the start of
 *  their email address (what the account gets when no name was given) is not a
 *  name, so it is ignored. */
export function firstName(name: string | null | undefined, email?: string | null): string | null {
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (!n) return null;
  const local = (email ?? "").split("@")[0].trim().toLowerCase();
  if (local && n.toLowerCase() === local) return null;
  const first = n.split(" ")[0].slice(0, 40);
  return first || null;
}

/** "Welcome, Ana." or "Welcome." */
export function welcomeLine(first: string | null): string {
  return first ? `Welcome, ${first}.` : "Welcome.";
}

export const START_QUESTION = "What do you want to do?";
export const NO_TEAMS_LINE = "You are not on a team yet. If someone shared a QR code, scan it to join.";
export const START_SIGN_IN = "/login?callbackUrl=/start";
