import { NextResponse } from "next/server";
import { TOOL_SPECS } from "@/lib/server/agent/agentTools";

// GET /api/agent/tools: the machine-readable list of what the external agent
// can do. For each tool: a description written for an LLM, the JSON schema of
// its inputs, whether it needs the researcher's access token, and whether it
// changes data. Public on purpose: it describes the API, not any data.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    auth:
      "Tools with needs_user_token=true must be called with the researcher's own Supabase access token as 'Authorization: Bearer <token>'. Actions run as that researcher, so a page they cannot see does not exist for you. Every tool with supports_preview=true accepts preview:true to describe a change without making it.",
    errors: "Errors are { error: { code, message } } with the matching HTTP status.",
    tools: TOOL_SPECS,
  });
}
