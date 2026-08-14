"use client";

// Project chatbot — floating widget, not an inline page section. Answers
// questions about THIS project from what's already stored (checklist,
// resources, team, shared folder, proposal, deadline) via /api/project-chat,
// which does all the real work (scoping, membership gate, the Groq call
// itself). This component is presentation only — it never talks to Groq or
// Supabase directly.
//
// WHY FLOATING, NOT INLINE: an inline "answer box" section pushed the
// checklist and everything below it down the page as the conversation grew,
// and reading a reply meant scrolling the whole page. A floating panel keeps
// the page behind it completely still — opening/closing never reflows page
// content, since the button and panel are `fixed`, entirely out of normal
// flow.
//
// FOOTER CLEARANCE: the footer (components/Footer.tsx) is a normal
// in-flow element, not `fixed` — nothing stops a `fixed bottom-6` button
// from visually sitting on top of it once a viewer scrolls to the bottom of
// a short page. useFooterClearance below tracks how much of the footer is
// currently inside the viewport and lifts the button by exactly that much
// (plus the usual 24px gap), so it always floats just above the footer's
// top edge instead of overlapping it, and drops back to a normal 24px
// corner offset everywhere else on the page.
//
// AVAILABLE ON EVERY PROJECT, including ColaboFest — unlike AgentSection
// (hidden there because it pushes proposals), this is pull-based: a member
// asks, nothing is proposed unprompted.
//
// HISTORY: kept in component state only, NOT persisted to the database —
// closing the panel keeps the conversation for this page visit, a refresh
// clears it. Said plainly in the empty state. Each request resends the last
// MAX_TURNS turns, capped the same way the server route caps what it reads
// back (see app/api/project-chat/route.ts's MAX_HISTORY_TURNS).

import { useEffect, useRef, useState } from "react";

type ChatTurn = { role: "user" | "assistant" | "error"; content: string };

const MAX_TURNS = 6; // matches MAX_HISTORY_TURNS in app/api/project-chat/route.ts

const SUGGESTIONS = [
  "What are we still missing?",
  "What have we saved so far?",
  "Who's on this project?",
];

/** How many px the floating button (and panel) should lift off the
 *  viewport bottom to clear the footer, recomputed on scroll/resize. 0
 *  everywhere the footer isn't currently visible. */
function useFooterClearance(): number {
  const [clearance, setClearance] = useState(0);

  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;

    const update = () => {
      const rect = footer.getBoundingClientRect();
      const visible = Math.max(0, window.innerHeight - rect.top);
      setClearance(visible);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return clearance;
}

export default function ProjectChatbot({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const footerClearance = useFooterClearance();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, loading]);

  const ask = async (question: string) => {
    question = question.trim();
    if (!question || loading) return;

    setInput("");
    // Cap what's SENT, not just what's kept — a long conversation's payload
    // stays flat turn over turn, matching the server's own cap.
    const historyToSend = turns.filter((t) => t.role !== "error").slice(-MAX_TURNS * 2);
    setTurns((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await fetch("/api/project-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, question, history: historyToSend }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.answer !== "string") {
        throw new Error(data.error || "Couldn't get an answer right now.");
      }
      setTurns((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (e) {
      // Fail-closed: say so plainly, in the conversation itself (not a
      // banner that replaces it), and don't retry silently.
      setTurns((prev) => [
        ...prev,
        { role: "error", content: e instanceof Error ? e.message : "Couldn't get an answer right now." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open project assistant"
          style={{ bottom: `${24 + footerClearance}px` }}
          className="fixed right-6 z-[55] w-14 h-14 rounded-full bg-primary text-on-primary shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined text-[26px]">chat</span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Project assistant"
          className="fixed z-[60] flex flex-col bg-surface-container-lowest shadow-2xl border border-outline-variant/30
            inset-x-3 top-20 bottom-3 rounded-2xl
            sm:inset-x-auto sm:top-auto sm:left-auto sm:right-6 sm:bottom-24 sm:w-[400px] sm:h-[600px] sm:max-h-[80vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-outline-variant/20 shrink-0">
            <div className="min-w-0">
              <h2 className="font-label-lg text-label-lg text-on-background font-semibold">
                Project assistant
              </h2>
              <p className="font-body-sm text-body-sm text-secondary truncate">{projectName}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close project assistant"
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-background transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Message area — fixed height (panel is fixed height), scrolls internally */}
          <div ref={messagesRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
            {turns.length === 0 && (
              <div>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  I can answer questions about this project — what&apos;s saved, what&apos;s still
                  missing, who&apos;s on the team. History isn&apos;t saved; refreshing the page
                  starts a new conversation.
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="text-left px-4 py-2.5 rounded-xl border border-primary/30 bg-primary/5 text-primary font-label-sm text-label-sm hover:bg-primary/10 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => {
              if (t.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] bg-primary/15 text-on-background rounded-2xl rounded-br-sm px-4 py-2.5">
                      <p className="font-body-sm text-body-sm whitespace-pre-wrap">{t.content}</p>
                    </div>
                  </div>
                );
              }
              if (t.role === "error") {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] bg-error/10 border border-error/30 text-error rounded-2xl rounded-bl-sm px-4 py-2.5">
                      <p className="font-body-sm text-body-sm whitespace-pre-wrap" role="alert">
                        {t.content}
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] bg-surface-container-low text-on-background rounded-2xl rounded-bl-sm px-4 py-2.5">
                    <p className="font-body-sm text-body-sm whitespace-pre-wrap">{t.content}</p>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface-container-low rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-bounce" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input pinned at the bottom of the panel */}
          <div className="shrink-0 border-t border-outline-variant/20 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask a question…"
                rows={1}
                className="flex-1 resize-none max-h-28 px-3.5 py-2.5 rounded-xl border border-outline-variant/40 bg-surface-container-lowest font-body-sm text-body-sm text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={() => ask(input)}
                disabled={!input.trim() || loading}
                aria-label="Send"
                className="shrink-0 w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[20px]">send</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
