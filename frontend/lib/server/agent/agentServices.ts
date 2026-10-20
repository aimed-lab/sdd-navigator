// lib/server/agent/agentServices.ts — the real operations behind the agent
// tools (see AgentServices in agentHandlers.ts). Everything here either runs
// with the researcher's token-bound client (passed in by the handlers) or is
// the same code the website uses.

import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { createLivingPage } from "@/lib/server/pages/createPage";
import { setPageRefreshEnabled, setPageVisibility } from "@/lib/server/pages/pageAdmin";
import { addPageMember, listPageMemberDetails, removePageMember } from "@/lib/server/pages/pageMembers";
import { getPageView, listMyPages } from "@/lib/server/pages/pageView";
import { findSimilarPublicPage } from "@/lib/server/pages/similarPages";
import type { AgentServices } from "./agentHandlers";

export const realAgentServices: AgentServices = {
  listMyPages,
  getPageView,
  createLivingPage,
  addPageMember,
  removePageMember,
  listPageMemberDetails,
  setPageVisibility,
  setPageRefreshEnabled,
  findSimilarPublicPage,
  async exploreSearch(query) {
    const res = await fetch(`${EXPLORE_API_URL}/api/explore`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input: query, personalize: false }),
    });
    if (!res.ok) throw new Error(`explore backend responded ${res.status}`);
    return res.json();
  },
};
