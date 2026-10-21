import { NextResponse } from "next/server";
import { cleanMessagesForSend } from "@/lib/server/assistant/assistantReply";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS, clientIp, createRateLimiter } from "@/lib/server/rateLimit";

// POST /api/assistant — one turn of the Explore AI assistant, forwarded to
// explore-mcp's POST /api/assistant-turn. The assistant only PROPOSES; this
// route never creates anything. Creating a page is a separate, explicit
// POST /api/pages the browser makes with the user's own session after they
// click Confirm.
//
// SIGNED-OUT USERS CAN CHAT (that is why there is no auth check); creating
// needs sign-in, enforced by /api/pages. Because it is an unauthenticated
// route that spends LLM tokens, it has a small per-IP limit and a body size
// cap. The limit lives in this process's memory, so it is best-effort
// protection against casual abuse, not a guarantee across instances.

export const maxDuration = 60;

const MAX_BODY_BYTES = 40_000;
const limiter = createRateLimiter(ASSISTANT_WINDOW_MS, ASSISTANT_MAX_REQUESTS);

export async function POST(req: Request) {
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
  const ctx = record.context && typeof record.context === "object" ? (record.context as Record<string, unknown>) : {};
  const query = typeof ctx.query === "string" ? ctx.query.trim().slice(0, 200) : "";
  const pageCreated = ctx.page_created === true;

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/assistant-turn`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        messages,
        context: { ...(query ? { query } : {}), ...(pageCreated ? { page_created: true } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`assistant backend responded ${res.status}`);
    return NextResponse.json(await res.json());
  } catch (e) {
    console.error("POST /api/assistant: backend call failed", e);
    return NextResponse.json({ error: "The assistant isn't available right now." }, { status: 502 });
  }
}
