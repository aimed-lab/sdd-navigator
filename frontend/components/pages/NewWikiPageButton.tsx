"use client";

// "New wiki page": opens the assistant with the request already typed, the same
// way Explore's "Your wiki" card does. The assistant's usual who-can-see-it
// choice and confirm step follow; nothing is created here.

import { START_LIVING_PAGE_MESSAGE, openAssistant } from "@/lib/server/assistant/assistantBridge";
import { ASSISTANT_ENABLED } from "@/lib/siteMode";

export default function NewWikiPageButton({ primary = true }: { primary?: boolean }) {
  // Not reachable from the teams site for now (assistantEnabled in lib/siteMode.ts).
  if (!ASSISTANT_ENABLED) return null;
  return (
    <button
      type="button"
      onClick={() => openAssistant({ text: START_LIVING_PAGE_MESSAGE, mode: "send" })}
      className={
        (primary ? "btn-primary" : "btn-outline") +
        " inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
      }
    >
      <span className="material-symbols-outlined text-[20px]">add</span>
      New wiki page
    </button>
  );
}

/** The wiki page's one main button: opens the assistant with a question about this page's topic ready to finish. */
export function AskAssistantButton({ title }: { title: string }) {
  if (!ASSISTANT_ENABLED) return null;
  return (
    <button
      type="button"
      onClick={() => openAssistant({ text: `About my wiki page "${title.slice(0, 120)}": `, mode: "fill" })}
      className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
    >
      <span className="material-symbols-outlined text-[20px]">chat</span>
      Ask the assistant
    </button>
  );
}
