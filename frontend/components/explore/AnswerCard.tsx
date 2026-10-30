"use client";

// The "Answer" card at the top of /explore/<topic>: the assistant's short,
// cited answer for the topic (the same /api/assistant call and the same answer
// rendering the side panel uses; signed-in people only), with the quick-facts row under it. While the
// answer loads a placeholder shows; if the call fails the card is hidden and the
// results below are untouched. The quick facts come from the results already on
// the page and link to the matching tab.

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Markdown } from "@/components/explore/AssistantChat";
import { parseAssistantReply } from "@/lib/server/assistant/assistantReply";
import { quickFacts, sourcesToCards, stripChoiceText, type ResultCard } from "@/lib/server/assistant/assistantAnswer";
import type { ExploreSection } from "@/types/explore";

type State =
  | { kind: "loading" }
  | { kind: "ok"; text: string; cards: ResultCard[] }
  | { kind: "failed" };

export default function AnswerCard({
  topic,
  sections,
  onOpenTab,
}: {
  topic: string;
  sections: ExploreSection[];
  /** Opens the results tab for a quick-fact row's kind. */
  onOpenTab: (kind: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!topic.trim() || authLoading) return;
    // The AI answer needs sign-in (/api/assistant answers 401 otherwise). Signed
    // out, the card stays hidden and the search results below are untouched.
    if (!user) {
      setState({ kind: "failed" });
      return;
    }
    const ctl = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: `What is known about ${topic}?` }], context: { query: topic } }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const parsed = parseAssistantReply(await res.json());
        // A reply that is really a proposal (page / community) is not an answer.
        if (!parsed || parsed.action || parsed.community) throw new Error("not an answer");
        const text = stripChoiceText(parsed.reply).trim();
        if (!text) throw new Error("empty");
        setState({ kind: "ok", text, cards: sourcesToCards(parsed.sources) });
      } catch {
        if (!ctl.signal.aborted) setState({ kind: "failed" });
      }
    })();
    return () => ctl.abort();
  }, [topic, user, authLoading]);

  const facts = quickFacts(sections, topic);

  return (
    <div className="flex flex-col gap-4">
      {state.kind !== "failed" && (
        <section aria-label="Answer" className="rounded-2xl bg-white border border-outline-variant/30 p-6 flex flex-col gap-3">
          <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">Answer</span>
          {state.kind === "loading" ? (
            <div className="flex flex-col gap-2 animate-pulse" role="status" aria-label="Writing the answer">
              <div className="h-3 rounded bg-surface-container-low w-11/12" />
              <div className="h-3 rounded bg-surface-container-low w-10/12" />
              <div className="h-3 rounded bg-surface-container-low w-7/12" />
            </div>
          ) : (
            <>
              <div className="font-body-md text-body-md text-on-background leading-relaxed">
                <Markdown text={state.text} maxCite={state.cards.length} />
              </div>
              {state.cards.length > 0 && (
                <ol className="flex flex-col gap-1 pt-1">
                  {state.cards.map((c, i) => (
                    <li key={c.id} className="font-body-sm text-body-sm text-secondary flex gap-2 min-w-0">
                      <span className="shrink-0 font-semibold text-primary">{i + 1}</span>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary hover:underline underline-offset-2">
                          {c.title}
                        </a>
                      ) : (
                        <span className="truncate">{c.title}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      )}

      {facts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Quick facts">
          {facts.map((f) => (
            <button
              key={f.kind}
              type="button"
              onClick={() => onOpenTab(f.kind)}
              className="text-left rounded-xl bg-white border border-outline-variant/30 hover:border-primary px-4 py-3 transition-colors min-w-0"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-label-md text-label-md text-on-background">{f.label}</span>
                <span className="px-2 py-0.5 rounded-full bg-surface-container-low text-primary font-label-sm text-[11px]">{f.count}</span>
              </span>
              <span className="block mt-1 font-body-sm text-body-sm text-secondary line-clamp-2">{f.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
