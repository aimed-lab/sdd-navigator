// Service Providers directory: validation for the three forms. Pure. Each
// parser returns the cleaned, length-limited values or a plain error message;
// the same limits are enforced by CHECK constraints in the database.

export const LIMITS = {
  company: 120,
  website: 300,
  person: 120,
  email: 200,
  role: 120,
  offer: 1500,
  need: 1000,
  budget: 100,
  message: 2000,
  note: 1000,
} as const;

export const TIMELINES = ["As soon as possible", "Within 3 months", "3 to 6 months", "Just exploring"] as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function text(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** Like text() but keeps line breaks (for free-text boxes). */
function para(v: unknown): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function httpUrl(s: string): string | null {
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

function tooLong(label: string, s: string, max: number): string | null {
  return s.length > max ? `${label} is too long (${max} characters at most).` : null;
}

export type ProviderRequestInput = {
  company: string;
  website: string;
  contact_name: string;
  email: string;
  offer: string;
};

export function parseProviderRequest(input: unknown): Parsed<ProviderRequestInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const company = text(o.company);
  const websiteRaw = text(o.website);
  const contact_name = text(o.contact_name);
  const email = text(o.email);
  const offer = para(o.offer);
  if (!company) return { ok: false, error: "Add your company name." };
  if (!websiteRaw) return { ok: false, error: "Add your website." };
  const website = httpUrl(websiteRaw);
  if (!website) return { ok: false, error: "That website doesn't look right." };
  if (!contact_name) return { ok: false, error: "Add a contact name." };
  if (!isEmail(email)) return { ok: false, error: "Add a valid email address." };
  if (!offer) return { ok: false, error: "Tell us briefly what you offer." };
  const err =
    tooLong("Company name", company, LIMITS.company) ??
    tooLong("Website", website, LIMITS.website) ??
    tooLong("Contact name", contact_name, LIMITS.person) ??
    tooLong("Email", email, LIMITS.email) ??
    tooLong("The description", offer, LIMITS.offer);
  if (err) return { ok: false, error: err };
  return { ok: true, value: { company, website, contact_name, email, offer } };
}

export type QuoteInput = { need: string; timeline: string; budget: string; message: string };

export function parseQuote(input: unknown): Parsed<QuoteInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const need = para(o.need);
  const timeline = text(o.timeline);
  const budget = text(o.budget);
  const message = para(o.message);
  if (!need) return { ok: false, error: "Tell them what you need." };
  if (!(TIMELINES as readonly string[]).includes(timeline)) return { ok: false, error: "Pick a timeline." };
  const err =
    tooLong("What you need", need, LIMITS.need) ??
    tooLong("Budget", budget, LIMITS.budget) ??
    tooLong("Message", message, LIMITS.message);
  if (err) return { ok: false, error: err };
  return { ok: true, value: { need, timeline, budget, message } };
}

export type ClaimInput = { name: string; role: string; work_email: string; note: string };

export function parseClaim(input: unknown): Parsed<ClaimInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const name = text(o.name);
  const role = text(o.role);
  const work_email = text(o.work_email);
  const note = para(o.note);
  if (!name) return { ok: false, error: "Add your name." };
  if (!role) return { ok: false, error: "Add your role at the company." };
  if (!isEmail(work_email)) return { ok: false, error: "Add a valid work email." };
  const err =
    tooLong("Name", name, LIMITS.person) ??
    tooLong("Role", role, LIMITS.role) ??
    tooLong("Email", work_email, LIMITS.email) ??
    tooLong("Note", note, LIMITS.note);
  if (err) return { ok: false, error: err };
  return { ok: true, value: { name, role, work_email, note } };
}
