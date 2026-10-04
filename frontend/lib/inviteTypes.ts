// Shared by the /invite form (client) and lib/server/invite.ts. Lives outside
// lib/server/ so the client component can import the values without pulling in
// next/headers.

export const INVITE_ROLES = ["Researcher", "Industry", "Vendor or CRO", "Other"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

// `key` is what ?interest=<key> matches; `label` is what's shown and stored.
export const INVITE_INTERESTS = [
  { key: "pipeline", label: "Project pipeline" },
  { key: "talent", label: "Talent network" },
  { key: "cohorts", label: "Patient cohorts (OneFlorida+)" },
  { key: "synthetic", label: "Synthetic patients" },
  { key: "mcp", label: "AI access through MCP" },
  { key: "sponsor", label: "Sponsoring a challenge" },
] as const;

export const INVITE_INTEREST_LABELS: string[] = INVITE_INTERESTS.map((i) => i.label);

export type InviteInput = {
  name: string;
  email: string;
  organization: string;
  role: string;
  interests: string[];
  message: string;
  source_page: string;
};

export type InviteFieldErrors = Partial<Record<"name" | "email" | "organization" | "role", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Same rules client and server side. Returns {} when valid. */
export function validateInvite(input: InviteInput): InviteFieldErrors {
  const errors: InviteFieldErrors = {};
  if (!input.name.trim()) errors.name = "Please enter your name.";
  if (!input.email.trim()) errors.email = "Please enter your email.";
  else if (!EMAIL_RE.test(input.email.trim())) errors.email = "Please enter a valid email address.";
  if (!input.organization.trim()) errors.organization = "Please enter your organization.";
  if (!(INVITE_ROLES as readonly string[]).includes(input.role)) {
    errors.role = "Please choose one.";
  }
  return errors;
}

/** Maps ?interest=<key or label> to a label, or null. */
export function interestFromParam(param: string | undefined): string | null {
  if (!param) return null;
  const p = param.trim().toLowerCase();
  const hit = INVITE_INTERESTS.find((i) => i.key === p || i.label.toLowerCase() === p);
  return hit ? hit.label : null;
}
