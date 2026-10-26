import { runAgentTool } from "@/lib/server/agent/agentRuntime";

// POST /api/agent/get_project_status: see lib/server/agent/agentTools.ts for the contract and
// agentCore.ts for the pipeline (auth, rate limit, validation, preview, log).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return runAgentTool("get_project_status", req);
}
