"use client";

// The Explore AI assistant (v1): a box, "What are you working on?", that opens
// a short chat. Its first tool is creating a living page.
//
// SAFETY PATTERN (same as the project agent): the model only PROPOSES. The
// reply can carry an `action`; this component shows a confirm card, and only
// when the user clicks Create does it call POST /api/pages, with the signed-in
// user's own session. Nothing the model says is executed directly, and
// everything it returns is validated first (parseAssistantReply).
//
// Signed-out users can chat. Creating needs sign-in: at Create the chat is
// saved to sessionStorage and the user is sent to /login with this page as the
// callback, then the conversation (and the pending confirm card) comes back.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  CHAT_STORAGE_KEY,
  CHOICE_INFO,
  VISIBILITIES,
  parseAssistantReply,
  restoreChat,
  serializeChat,
  type ChatMessage,
  type CreatePageAction,
  type Visibility,
} from "@/lib/server/assistant/assistantReply";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "duplicate"; slug: string; title: string }
  | { kind: "collecting" }
  | { kind: "done"; slug: string; visibility: Visibility }
  | { kind: "error"; message: string };

const OPENING = "Tell me what you work on or want to keep track of, and I'll look at what's out there.";

export default function AssistantChat({ query }: { query?: string }) {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [choices, setChoices] = useState<Visibility[] | null>(null);
  const [action, setAction] = useState<CreatePageAction | null>(null);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [restored, setRestored] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore the conversation (e.g. after the sign-in round trip).
  useEffect(() => {
    try {
      const snap = restoreChat(window.sessionStorage.getItem(CHAT_STORAGE_KEY));
      if (snap) {
        setMessages(snap.messages);
        setChoices(snap.choices);
        setAction(snap.action);
        setOpen(true);
      }
    } catch {
      // sessionStorage can be unavailable (private mode, blocked); start fresh.
    }
    setRestored(true);
  }, []);

  // Keep the snapshot current. Cleared once a page has been created.
  useEffect(() => {
    if (!restored) return;
    try {
      if (messages.length === 0 || phase.kind === "done") {
        window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(CHAT_STORAGE_KEY, serializeChat({ messages, choices, action }));
      }
    } catch {
      // Not worth surfacing; the chat just won't survive a reload.
    }
  }, [restored, messages, choices, action, phase.kind]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, typing, action, choices, phase]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || typing) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setChoices(null);
    setAction(null);
    setPhase({ kind: "idle" });
    setError(null);
    setTyping(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: query ? { query } : {} }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = parseAssistantReply(await res.json());
      if (!parsed) throw new Error("unusable reply");
      setMessages([...next, { role: "assistant", content: parsed.reply }]);
      setChoices(parsed.choices ?? null);
      setAction(parsed.action ?? null);
    } catch {
      setError("The assistant isn't available right now. Please try again.");
    } finally {
      setTyping(false);
    }
  };

  const createPage = async (a: CreatePageAction, skipDuplicateCheck = false) => {
    if (!user) {
      // Chat is already in sessionStorage (effect above); come back to this page.
      const back = pathname + (typeof window !== "undefined" ? window.location.search : "");
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(back)}`);
      return;
    }

    if (a.visibility === "public" && !skipDuplicateCheck) {
      setPhase({ kind: "checking" });
      try {
        const res = await fetch(
          `/api/pages/similar?title=${encodeURIComponent(a.title)}&seed=${encodeURIComponent(a.seed_input)}`
        );
        const json = res.ok ? await res.json() : null;
        if (json?.match?.slug) {
          setPhase({ kind: "duplicate", slug: json.match.slug, title: json.match.title });
          return;
        }
      } catch {
        // The check is a courtesy; if it fails, carry on and create.
      }
    }

    setPhase({ kind: "collecting" });
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: a.seed_input, title: a.title, visibility: a.visibility }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.slug !== "string") {
        throw new Error(typeof json?.error === "string" ? json.error : "Couldn't create the page.");
      }
      setAction(null);
      setPhase({ kind: "done", slug: json.slug, visibility: a.visibility });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Couldn't create the page." });
    }
  };

  const change = () => {
    setAction(null);
    setPhase({ kind: "idle" });
    setChoices(VISIBILITIES);
  };

  const reset = () => {
    setMessages([]);
    setChoices(null);
    setAction(null);
    setPhase({ kind: "idle" });
    setError(null);
  };

  const busy = typing || phase.kind === "checking" || phase.kind === "collecting";

  return (
    <section className="max-w-3xl mb-8" aria-label="Assistant">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full h-14 px-5 flex items-center gap-3 bg-white border border-outline-variant/40 rounded-[14px] text-left hover:border-primary transition-all"
        >
          <span className="material-symbols-outlined text-primary">chat</span>
          <span className="font-body-md text-body-md text-secondary/70">What are you working on?</span>
        </button>
      ) : (
        <div className="bg-white border border-outline-variant/40 rounded-[14px] p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-label-md text-label-md text-on-background">What are you working on?</h2>
            <div className="flex items-center gap-4">
              {messages.length > 0 && (
                <button type="button" onClick={reset} className="font-label-sm text-label-sm text-secondary hover:text-primary">
                  New chat
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="text-secondary hover:text-primary"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto" aria-live="polite">
            {messages.length === 0 && (
              <p className="font-body-md text-body-md text-secondary">{OPENING}</p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  "max-w-[85%] px-4 py-2.5 rounded-[14px] font-body-md text-body-md whitespace-pre-wrap " +
                  (m.role === "user"
                    ? "self-end bg-primary/10 text-on-background"
                    : "self-start bg-surface-container-low text-on-background")
                }
              >
                {m.content}
              </div>
            ))}
            {typing && (
              <div className="self-start px-4 py-2.5 rounded-[14px] bg-surface-container-low text-secondary font-body-md text-body-md animate-pulse">
                Thinking…
              </div>
            )}

            {choices && !typing && (
              <div className="flex flex-col gap-2" role="group" aria-label="Page type">
                {choices.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => send(CHOICE_INFO[v].label)}
                    disabled={busy}
                    className={
                      "text-left px-4 py-3 rounded-[14px] border transition-all disabled:opacity-50 " +
                      (v === "private"
                        ? "border-primary bg-primary/5"
                        : "border-outline-variant/40 hover:border-primary")
                    }
                  >
                    <span className="font-label-md text-label-md text-on-background">{CHOICE_INFO[v].label}</span>
                    <span className="block font-body-sm text-body-sm text-secondary">{CHOICE_INFO[v].line}</span>
                  </button>
                ))}
              </div>
            )}

            {action && phase.kind === "idle" && !typing && (
              <div className="rounded-[14px] border border-primary/40 bg-primary/5 p-4 flex flex-col gap-3">
                <p className="font-body-md text-body-md text-on-background">
                  Create {action.visibility} page &lsquo;{action.title}&rsquo;?
                </p>
                {!authLoading && !user && (
                  <p className="font-body-sm text-body-sm text-secondary">You&apos;ll be asked to sign in first.</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => createPage(action)}
                    disabled={authLoading}
                    className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={change}
                    className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            {phase.kind === "checking" && (
              <p className="font-body-sm text-body-sm text-secondary">Checking for an existing public page…</p>
            )}

            {phase.kind === "duplicate" && action && (
              <div className="rounded-[14px] border border-outline-variant/40 p-4 flex flex-col gap-3">
                <p className="font-body-md text-body-md text-on-background">
                  A public page on this already exists: &lsquo;{phase.title}&rsquo;.
                </p>
                <div className="flex gap-3">
                  <a
                    href={`/pages/${phase.slug}`}
                    className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Open it
                  </a>
                  <button
                    type="button"
                    onClick={() => createPage(action, true)}
                    className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Create mine anyway
                  </button>
                </div>
              </div>
            )}

            {phase.kind === "collecting" && (
              <p className="font-body-md text-body-md text-secondary animate-pulse" role="status">
                Collecting sources… about a minute.
              </p>
            )}

            {phase.kind === "done" && (
              <div className="rounded-[14px] border border-primary/40 bg-primary/5 p-4 flex flex-col gap-3" role="status">
                <p className="font-body-md text-body-md text-on-background">Your page is ready.</p>
                <a
                  href={`/pages/${phase.slug}${phase.visibility === "team" ? "#team" : ""}`}
                  className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md"
                >
                  {phase.visibility === "team" ? "Open it and invite your team" : "Open your page"}
                </a>
              </div>
            )}

            {phase.kind === "error" && action && (
              <div className="flex flex-col gap-2">
                <p className="font-body-sm text-body-sm text-error" role="alert">
                  {phase.message}
                </p>
                <button
                  type="button"
                  onClick={() => createPage(action, true)}
                  className="btn-outline self-start px-5 py-2 rounded-lg font-label-md text-label-md"
                >
                  Try again
                </button>
              </div>
            )}

            {error && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              type="text"
              maxLength={500}
              placeholder="e.g. I study EGFR inhibitor resistance in lung cancer"
              aria-label="Message"
              disabled={phase.kind === "done"}
              className="flex-1 min-w-0 h-11 px-4 bg-white border border-outline-variant/40 rounded-[14px] focus:ring-2 focus:ring-primary/20 focus:border-primary font-body-md text-body-md placeholder:text-secondary/50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || phase.kind === "done"}
              className="btn-primary px-5 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
