import { NextResponse } from "next/server";
import { getCurrentUserInterests } from "@/lib/server/interests";

// Proxy for the Python explore backend. POST { input } -> the backend's
// { input, scope, tools_called, reasoning, sections } JSON. The backend exposes
// a plain-HTTP bridge at POST /api/explore (added alongside its MCP interface).
//
// PERSONALIZATION. A blank `input` asks for the landing feed. Before forwarding
// it, this route reads the SIGNED-IN user's saved interests and sends them on as
// the feed's scope, so a logged-in scientist's front page is about their own
// work instead of the field at large. Signed out, or with no interests saved,
// nothing is sent and the backend serves the generic field-wide default.
//
// The interests are read HERE, from the session cookie, and are never accepted
// from the request body: a caller cannot ask for someone else's feed, and the
// browser never has to be trusted with (or told) what the scope should be. The
// backend caches the result under the terms' own normalized key, so one user's
// feed can neither be served from nor overwrite the shared default entry.
//
// `personalize: false` opts a request out — the feed sends it when the user has
// cleared the scope chips, which means "show me the generic feed, not mine".
//
// Resilience contract: this route NEVER 500s the page. On any failure it returns
// { sections: [], scope: {}, error: true } with HTTP 200 so the UI can render a
// clean empty state instead of crashing.

const EXPLORE_API_URL = process.env.EXPLORE_API_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  let input = "";
  let personalize = true;
  try {
    const body = await req.json();
    if (body && typeof body.input === "string") input = body.input;
    if (body && body.personalize === false) personalize = false;
  } catch {
    // malformed body -> treat as empty input (backend serves the default feed)
  }

  // Only the blank landing feed is personalized. A real search is the user's
  // explicit scope and must not be widened by their profile.
  let scope: string[] = [];
  if (personalize && !input.trim()) {
    try {
      scope = await getCurrentUserInterests();
    } catch (e) {
      // A profile read failing is not a reason to lose the feed — fall back to
      // the generic one rather than erroring the page.
      console.error("explore: interests lookup failed", e);
    }
  }

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/explore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scope.length > 0 ? { input, scope } : { input }),
    });
    if (!res.ok) throw new Error(`explore backend responded ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ sections: [], scope: {}, error: true }, { status: 200 });
  }
}
