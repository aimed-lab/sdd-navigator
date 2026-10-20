// lib/server/agent/agentCore.ts — the request pipeline for every agent tool:
// find the tool, authenticate, rate-limit, validate, run (or preview), log.
// All I/O is injected (AgentDeps), so `npm test` runs it with fakes and no
// Supabase or Next.js. agentRuntime.ts wires the real dependencies.
//
// ORDER MATTERS: authentication comes first, so an unauthenticated caller
// learns nothing about a tool's inputs or about any page.

import { findTool, normalizeInput, validateInput, type ToolSpec } from "./agentTools.ts";

export type AgentUser = { id: string; email: string | null };

// The authenticated acting context: the user plus a database client bound to
// THEIR token. (Same shape as pages/actingContext.ts's ActingContext.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentContext = { user: AgentUser; db: any };

export type ToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

export type HandlerArgs = {
  input: Record<string, unknown>;
  preview: boolean;
  ctx: AgentContext | null; // null only for tools that need no user token
  origin: string;
};

export type ToolHandler = (args: HandlerArgs) => Promise<ToolResult>;

export type AgentLogEntry = {
  event: "agent_write";
  user_id: string;
  tool: string;
  ok: boolean;
  status: number;
  code?: string;
};

export type AgentDeps = {
  /** Resolve a bearer token to the researcher, or null if it is not valid. */
  authenticate(token: string): Promise<AgentContext | null>;
  handlers: Record<string, ToolHandler>;
  /** true when this key has made too many writes in the window (records a hit). */
  writeLimited(userId: string): boolean;
  /** true when this IP has made too many search calls in the window. */
  searchLimited(ip: string): boolean;
  log(entry: AgentLogEntry): void;
};

export type AgentRequest = {
  authorization: string | null;
  ip: string;
  origin: string;
  rawBody: string;
};

export type AgentResponse = { status: number; body: Record<string, unknown> };

export function errorResponse(status: number, code: string, message: string): AgentResponse {
  return { status, body: { error: { code, message } } };
}

export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

function parseBody(raw: string): { ok: true; value: unknown } | { ok: false } {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export async function handleAgentCall(
  deps: AgentDeps,
  toolName: string,
  req: AgentRequest
): Promise<AgentResponse> {
  const spec: ToolSpec | undefined = findTool(toolName);
  const handler = spec ? deps.handlers[spec.name] : undefined;
  if (!spec || !handler) return errorResponse(404, "unknown_tool", `No such tool: ${toolName}.`);

  // 1. Who is calling?
  let ctx: AgentContext | null = null;
  if (spec.needs_user_token) {
    const token = bearerToken(req.authorization);
    if (!token) {
      return errorResponse(401, "unauthorized", "Send the researcher's access token as 'Authorization: Bearer <token>'.");
    }
    try {
      ctx = await deps.authenticate(token);
    } catch (e) {
      console.error("agent: authenticate threw", e);
      ctx = null;
    }
    if (!ctx) return errorResponse(401, "unauthorized", "The access token is invalid or expired.");
  } else if (deps.searchLimited(req.ip)) {
    return errorResponse(429, "rate_limited", "Too many requests. Please wait a few minutes.");
  }

  // 2. Is the input well-formed?
  const parsed = parseBody(req.rawBody);
  if (!parsed.ok) return errorResponse(400, "invalid_input", "Request body must be valid JSON.");
  const problem = validateInput(spec.input_schema, parsed.value);
  if (problem) return errorResponse(400, "invalid_input", problem);
  const input = normalizeInput(parsed.value as Record<string, unknown>);

  // 3. Run it. A preview describes the change and never writes.
  const preview = spec.supports_preview && input.preview === true;
  delete input.preview;
  const isWrite = spec.changes_data && !preview;

  if (isWrite && ctx && deps.writeLimited(ctx.user.id)) {
    return errorResponse(429, "rate_limited", "Too many changes in a short time. Please wait a minute.");
  }

  let result: ToolResult;
  try {
    result = await handler({ input, preview, ctx, origin: req.origin });
  } catch (e) {
    console.error(`agent: tool ${spec.name} threw`, e);
    result = { ok: false, status: 500, code: "server_error", message: "Something went wrong. Please try again." };
  }

  if (isWrite && ctx) {
    deps.log({
      event: "agent_write",
      user_id: ctx.user.id,
      tool: spec.name,
      ok: result.ok,
      status: result.ok ? 200 : result.status,
      ...(result.ok ? {} : { code: result.code }),
    });
  }

  return result.ok
    ? { status: 200, body: { ...result.data, ...(preview ? { preview: true } : {}) } }
    : errorResponse(result.status, result.code, result.message);
}
