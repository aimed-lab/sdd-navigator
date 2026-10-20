import { runAgentTool } from "@/lib/server/agent/agentRuntime";

// POST /api/agent/create_page: see lib/server/agent/agentTools.ts for the contract and
// agentCore.ts for the pipeline (auth, rate limit, validation, preview, log).
export const dynamic = "force-dynamic";

// Creating a page researches the topic first, which takes about a minute.
export const maxDuration = 300;

export async function POST(req: Request) {
  return runAgentTool("create_page", req);
}
