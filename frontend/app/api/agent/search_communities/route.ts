import { runAgentTool } from "@/lib/server/agent/agentRuntime";

// POST /api/agent/search_communities: see lib/server/agent/agentTools.ts for the contract and
// agentCore.ts for the pipeline (auth, rate limit, validation, preview, log).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return runAgentTool("search_communities", req);
}
