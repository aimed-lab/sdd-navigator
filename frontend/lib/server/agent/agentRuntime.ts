// lib/server/agent/agentRuntime.ts — wires the real dependencies into
// handleAgentCall and adapts Request/Response. Every /api/agent/<tool>/route.ts
// is one line calling runAgentTool("<tool>", req).

import { NextResponse } from "next/server";
import { authenticateToken } from "./agentAuth";
import { handleAgentCall, type AgentDeps } from "./agentCore";
import { makeAgentHandlers } from "./agentHandlers";
import { realAgentServices } from "./agentServices";
import {
  ASSISTANT_MAX_REQUESTS,
  ASSISTANT_WINDOW_MS,
  clientIp,
  createRateLimiter,
} from "@/lib/server/rateLimit";

const MAX_BODY_BYTES = 20_000;

// 30 writes per minute per researcher.
export const WRITES_PER_MINUTE = 30;
const writeLimiter = createRateLimiter(60_000, WRITES_PER_MINUTE);
// Search needs no token: the same per-IP limit as /api/assistant.
const searchLimiter = createRateLimiter(ASSISTANT_WINDOW_MS, ASSISTANT_MAX_REQUESTS);

const deps: AgentDeps = {
  authenticate: authenticateToken,
  handlers: makeAgentHandlers(realAgentServices),
  writeLimited: (userId) => writeLimiter.limited(userId),
  searchLimited: (ip) => searchLimiter.limited(ip),
  log: (entry) => console.log(JSON.stringify(entry)),
};

/** The origin the agent should build page links from (behind a proxy, the
 *  forwarded host/proto, else the request URL). */
export function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function runAgentTool(toolName: string, req: Request): Promise<NextResponse> {
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "invalid_input", message: "Request too large." } }, { status: 413 });
  }
  const res = await handleAgentCall(deps, toolName, {
    authorization: req.headers.get("authorization"),
    ip: clientIp(req),
    origin: requestOrigin(req),
    rawBody,
  });
  return NextResponse.json(res.body, { status: res.status, headers: { "Cache-Control": "no-store" } });
}
