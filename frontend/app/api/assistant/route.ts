import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildAssistantContext, cleanMessagesForSend } from "@/lib/server/assistant/assistantReply";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS, clientIp, createRateLimiter } from "@/lib/server/rateLimit";

// POST /api/assistant — one turn of the Explore AI assistant, forwarded to
// explore-mcp's POST /api/assistant-turn. The assistant only PROPOSES; this
// route never creates anything. Creating a page is a separate, explicit
// POST /api/pages the browser makes with the user's own session after they
// click Confirm.
//
// SIGN-IN REQUIRED: the assistant spends LLM tokens, so a request with no
// signed-in user is answered 401 first, before the rate limiter, the body is
// read, or the backend is called. On top of that it keeps a small per-IP limit
// and a body size cap. The limit lives in this process's memory, so it is best-effort
// protection against casual abuse, not a guarantee across instances.

export const maxDuration = 60;

const MAX_BODY_BYTES = 40_000;
const limiter = createRateLimiter(ASSISTANT_WINDOW_MS, ASSISTANT_MAX_REQUESTS);

export async function POST(req: Request) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  }
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json({ error: "Too many messages. Please wait a few minutes." }, { status: 429 });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const messages = cleanMessagesForSend(record.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "The last message must be from the user." }, { status: 400 });
  }
  // query, page_created and communities_checked, nothing else (the last one
  // must reach the backend on every turn after the matches were shown).
  const context = buildAssistantContext(record.context);

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/assistant-turn`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ messages, context }),
    });
    if (!res.ok) throw new Error(`assistant backend responded ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (e) {
    console.error("POST /api/assistant: backend call failed", e);
    return NextResponse.json({ error: "The assistant isn't available right now." }, { status: 502 });
  }
}
