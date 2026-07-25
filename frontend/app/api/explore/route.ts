import { NextResponse } from "next/server";

// Proxy for the Python explore backend. POST { input } -> the backend's
// { input, scope, tools_called, reasoning, sections } JSON. The backend exposes
// a plain-HTTP bridge at POST /api/explore (added alongside its MCP interface).
//
// Resilience contract: this route NEVER 500s the page. On any failure it returns
// { sections: [], scope: {}, error: true } with HTTP 200 so the UI can render a
// clean empty state instead of crashing.

const EXPLORE_API_URL = process.env.EXPLORE_API_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  let input = "";
  try {
    const body = await req.json();
    if (body && typeof body.input === "string") input = body.input;
  } catch {
    // malformed body -> treat as empty input (backend serves the default feed)
  }

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/explore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) throw new Error(`explore backend responded ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ sections: [], scope: {}, error: true }, { status: 200 });
  }
}
