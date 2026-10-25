"use client";

// The "Ask the AI assistant" tile on /start: opens the assistant panel.

import ActionTile from "@/components/ui/ActionTile";
import { openAssistant } from "@/lib/server/assistant/assistantBridge";

export default function StartAssistantTile() {
  return (
    <ActionTile
      icon="auto_awesome"
      title="Ask the AI assistant"
      description="Find papers, trials and datasets, or ask it to create a team or a wiki page."
      action="Open the assistant →"
      tone="amber"
      onClick={() => openAssistant({ text: "", mode: "open" })}
    />
  );
}
