import { runAgentTool } from "@/lib/server/agent/agentRuntime";

// POST /api/agent/set_auto_update: see lib/server/agent/agentTools.ts for the contract and
// agentCore.ts for the pipeline (auth, rate limit, validation, preview, log).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return runAgentTool("set_auto_update", req);
}
