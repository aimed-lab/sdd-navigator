// lib/server/agent/agentTools.ts — the catalogue of tools the external AI agent
// can call (served by GET /api/agent/tools) and the input validator that
// enforces the very same schemas at runtime, so the documentation the agent
// reads and the checks we run cannot drift apart.
//
// No runtime imports, so `npm test` covers it.
//
// HOW THE AGENT IS TRUSTED: it is not. Every tool except `search` is called with
// the RESEARCHER'S OWN Supabase access token; the action runs with a client
// bound to that token, so row-level security decides what is allowed. The agent
// never receives database keys, and the server never falls back to the service
// role to authenticate or authorize an agent call.

export type JsonSchema = {
  type: "object";
  properties: Record<
    string,
    { type: "string" | "boolean"; description: string; enum?: string[]; minLength?: number; maxLength?: number }
  >;
  required: string[];
  additionalProperties: false;
};

export type ToolSpec = {
  name: string;
  description: string;
  endpoint: string;
  method: "POST";
  input_schema: JsonSchema;
  needs_user_token: boolean;
  changes_data: boolean;
  supports_preview: boolean;
};

const VISIBILITY_VALUES = ["private", "team", "public"];

const PREVIEW = {
  type: "boolean" as const,
  description:
    "If true, validate and describe what would happen WITHOUT doing it. Always preview first and show the user the result before calling again without preview.",
};

const SLUG = {
  type: "string" as const,
  description: "The page's slug, the last part of its URL (/pages/<slug>).",
  minLength: 1,
  maxLength: 200,
};

function tool(t: Omit<ToolSpec, "endpoint" | "method">): ToolSpec {
  return { ...t, endpoint: `/api/agent/${t.name}`, method: "POST" };
}

export const TOOL_SPECS: ToolSpec[] = [
  tool({
    name: "search",
    description:
      "Search all Explore sources (papers, preprints, clinical trials, FDA approvals, compounds, datasets, grants, news...) for a topic. " +
      "Returns how many results each source has plus the top results (title, url, kind, date). Use it to see what exists before suggesting a page. " +
      "Needs no user token. Read-only.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The topic to search, in plain words.", minLength: 2, maxLength: 300 } },
      required: ["query"],
      additionalProperties: false,
    },
    needs_user_token: false,
    changes_data: false,
    supports_preview: false,
  }),
  tool({
    name: "list_my_pages",
    description:
      "List the wiki pages the researcher owns plus the team pages they are a member of, with visibility, role and how many new items arrived in the last 7 days.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    needs_user_token: true,
    changes_data: false,
    supports_preview: false,
  }),
  tool({
    name: "get_page",
    description:
      "Read one wiki page: its notes with numbered citations, what was added in the last 30 days, and source counts by kind. " +
      "When the caller owns the page it also lists the team as members [{user_id, name, email, role}]. " +
      "Returns 404 for a page that does not exist or that the researcher is not allowed to see (the two are indistinguishable on purpose).",
    input_schema: { type: "object", properties: { slug: SLUG }, required: ["slug"], additionalProperties: false },
    needs_user_token: true,
    changes_data: false,
    supports_preview: false,
  }),
  tool({
    name: "create_page",
    description:
      "Create a wiki page on a topic: it researches the topic now (about a minute), then keeps itself updated. " +
      "visibility: 'private' = only the researcher; 'team' = the researcher plus people they add; 'public' = anyone can read it. " +
      "Ask the researcher which visibility they want; do not choose for them. " +
      "Call with preview:true first: it returns what would be created and any existing near-identical PUBLIC page the researcher may prefer to follow.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short page title.", minLength: 3, maxLength: 120 },
        seed_input: { type: "string", description: "Topic phrase the page researches, e.g. 'EGFR inhibitor resistance in lung cancer'.", minLength: 3, maxLength: 200 },
        visibility: { type: "string", description: "private, team or public.", enum: VISIBILITY_VALUES },
        preview: PREVIEW,
      },
      required: ["title", "seed_input", "visibility"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
  tool({
    name: "add_member",
    description:
      "Add a team member to a page by the email of an existing account, as 'editor' (can add notes and sources) or 'viewer' (read only). Owner only. " +
      "Members only get access while the page's visibility is 'team'; the result says whether the member is active now.",
    input_schema: {
      type: "object",
      properties: {
        slug: SLUG,
        email: { type: "string", description: "Email of an existing account.", minLength: 3, maxLength: 320 },
        role: { type: "string", description: "editor or viewer.", enum: ["editor", "viewer"] },
        preview: PREVIEW,
      },
      required: ["slug", "email", "role"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
  tool({
    name: "remove_member",
    description:
      "Remove a team member from a page. Owner only. Identify the member with EXACTLY ONE of: user_id (the account id shown in get_page's members list, " +
      "the same id add_member records) or email (the member's account email, resolved the same way add_member does). Give one, not both.",
    input_schema: {
      type: "object",
      properties: {
        slug: SLUG,
        user_id: { type: "string", description: "The member's account id, from get_page's members list. Use this or email.", minLength: 8, maxLength: 64 },
        email: { type: "string", description: "The member's account email. Use this or user_id.", minLength: 3, maxLength: 320 },
        preview: PREVIEW,
      },
      required: ["slug"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
  tool({
    name: "set_visibility",
    description:
      "Change who can see a page: private, team or public. Owner only. Making a page public lets anyone read it, so confirm with the researcher first (preview shows the change).",
    input_schema: {
      type: "object",
      properties: {
        slug: SLUG,
        visibility: { type: "string", description: "private, team or public.", enum: VISIBILITY_VALUES },
        preview: PREVIEW,
      },
      required: ["slug", "visibility"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
  tool({
    name: "set_auto_update",
    description: "Turn a page's automatic daily updating on or off. Owner only.",
    input_schema: {
      type: "object",
      properties: {
        slug: SLUG,
        enabled: { type: "boolean", description: "true to keep the page updated automatically." },
        preview: PREVIEW,
      },
      required: ["slug", "enabled"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
  tool({
    name: "search_communities",
    description:
      "Find existing communities for a topic. Returns up to 3 best matches: name, purpose, member count, whether anyone can join or it is by request, " +
      "why it matched, the researcher's own status (none, pending, member) and a link. Always run this before create_community.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The topic, in plain words, e.g. 'KRAS pancreatic cancer'.", minLength: 3, maxLength: 200 } },
      required: ["query"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: false,
    supports_preview: false,
  }),
  tool({
    name: "join_community",
    description:
      "Join a community, or request to join it. If the community is open the researcher becomes a member at once; otherwise an admin must approve the request. " +
      "Which of the two happens is decided by the community, not by you. Joining twice does nothing. Call with preview:true first and show the researcher which it will be.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The community's slug, the last part of its URL (/communities/<slug>).", minLength: 1, maxLength: 200 },
        preview: PREVIEW,
      },
      required: ["slug"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
  tool({
    name: "create_community",
    description:
      "Create a community; the researcher becomes its admin. New communities are by request (private). " +
      "Search first with search_communities and, if anything similar exists, ask whether they would rather join it. " +
      "Call with preview:true first: it returns what would be created and any similar existing communities (similar_communities). " +
      "Show that to the researcher and get a clear yes before calling again without preview.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Community name.", minLength: 3, maxLength: 80 },
        purpose: { type: "string", description: "One line on what the community is for.", minLength: 3, maxLength: 300 },
        preview: PREVIEW,
      },
      required: ["name", "purpose"],
      additionalProperties: false,
    },
    needs_user_token: true,
    changes_data: true,
    supports_preview: true,
  }),
];

export function findTool(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((t) => t.name === name);
}

// ── input validation ─────────────────────────────────────────────────────────

/** Checks `input` against a tool's schema. Returns an error message, or null
 *  when valid. Unknown fields are rejected so a mistyped name is caught. */
export function validateInput(schema: JsonSchema, input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "Request body must be a JSON object.";
  }
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(key in schema.properties)) return `Unknown field '${key}'.`;
  }
  for (const key of schema.required) {
    if (obj[key] === undefined || obj[key] === null) return `Missing required field '${key}'.`;
  }
  for (const [key, def] of Object.entries(schema.properties)) {
    const v = obj[key];
    if (v === undefined) continue;
    if (def.type === "boolean") {
      if (typeof v !== "boolean") return `Field '${key}' must be true or false.`;
      continue;
    }
    if (typeof v !== "string") return `Field '${key}' must be a string.`;
    const text = v.trim();
    if (def.enum && !def.enum.includes(text)) return `Field '${key}' must be one of: ${def.enum.join(", ")}.`;
    if (def.minLength !== undefined && text.length < def.minLength) {
      return `Field '${key}' must be at least ${def.minLength} characters.`;
    }
    if (def.maxLength !== undefined && text.length > def.maxLength) {
      return `Field '${key}' must be at most ${def.maxLength} characters.`;
    }
  }
  return null;
}

/** The input with strings trimmed, ready for a handler. */
export function normalizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === "string" ? v.trim() : v;
  return out;
}
