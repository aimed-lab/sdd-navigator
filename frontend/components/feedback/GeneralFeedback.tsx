"use client";

// The persistent, page-scoped "anything at all, any time" feedback box —
// used at the bottom of /explore, /collaborate, /promote, and a project
// page. NOT InlineFeedback: that component is a single blank textarea, and
// a blank box gets nothing — nobody knows what to write in it. This asks
// the three things actually worth knowing, one at a time, each optional
// past the first tap:
//
//   1. Was this useful to you?        — one tap, yes/no
//   2. What were you expecting that
//      you did not find?              — one line, optional
//   3. Anything else?                 — one line, optional
//
// APPEND-ONLY, same pattern as AgentSection's run-feedback widget: the tap
// is one row, each sentence (if the visitor bothers to type one) is
// another. `feedback` has no UPDATE policy (see
// database/migrations/2026-07-29_feedback.sql) — "add a second thought
// later" is naturally a second insert, never an edit of the first. Nothing
// here blocks on anything else: skipping a question fires nothing for it
// and just advances to the next one.
//
// ONE QUESTION AT A TIME, NOT ALL THREE FIELDS AT ONCE — asked to read as a
// question someone is asking, not a survey. A form shows every field up
// front; a conversation asks, then asks the next thing.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedbackAction } from "@/app/feedback/actions";

type Stage = "tap" | "expected" | "other" | "done";

export default function GeneralFeedback({
  pagePath,
  context,
}: {
  /** Defaults to the current route when omitted. */
  pagePath?: string;
  /** Extra context to ride along on every row this box writes — e.g. the
   *  query on a search results page, or project_id/project_name on a
   *  project page. Same `context` a caller would have passed InlineFeedback. */
  context?: Record<string, unknown>;
}) {
  const pathname = usePathname();
  const path = pagePath ?? pathname ?? "";

  const [stage, setStage] = useState<Stage>("tap");
  const [useful, setUseful] = useState<boolean | null>(null);
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);

  const send = (extra: Record<string, unknown>, message: string | null) => {
    // Fire-and-forget, like every other feedback write in this app — this
    // box must never block on the network, and a failed insert must never
    // surface to the visitor (submitFeedback itself never throws, but the
    // fetch this Server Action rides on could still reject client-side).
    submitFeedbackAction({
      page_path: path,
      message,
      context: { kind: "general_feedback", ...context, ...extra },
    }).catch(() => {});
  };

  const tap = (v: boolean) => {
    setUseful(v);
    send({ useful: v }, null);
    setStage("expected");
  };

  const submitLine = (question: "expected" | "other") => {
    const text = line.trim();
    if (text) send({ useful, question }, text);
    setLine("");
    setSending(false);
    setStage(question === "expected" ? "other" : "done");
  };

  if (stage === "done") {
    return (
      <p className="text-center font-body-sm text-body-sm text-secondary py-2">
        Thanks — this helps.
      </p>
    );
  }

  if (stage === "tap") {
    return (
      <div className="flex items-center justify-center gap-3 py-2">
        <span className="font-body-sm text-body-sm text-secondary">Was this useful to you?</span>
        <button
          type="button"
          onClick={() => tap(true)}
          className="px-3 py-1.5 rounded-full border border-outline-variant/50 font-label-sm text-label-sm text-secondary hover:text-primary hover:border-primary/50 transition-colors"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => tap(false)}
          className="px-3 py-1.5 rounded-full border border-outline-variant/50 font-label-sm text-label-sm text-secondary hover:text-primary hover:border-primary/50 transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  // stage is "expected" or "other" — one optional line, Enter or the small
  // arrow sends it; "Skip" moves on without writing anything for this one.
  const question =
    stage === "expected" ? "What were you expecting that you did not find?" : "Anything else?";

  return (
    <div className="max-w-md mx-auto py-2 flex items-center gap-2">
      <label className="sr-only">{question}</label>
      <input
        autoFocus
        type="text"
        value={line}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && line.trim()) {
            setSending(true);
            submitLine(stage);
          }
        }}
        placeholder={question}
        className="flex-1 bg-transparent border-b border-outline-variant/40 focus:border-primary px-1 py-1.5 font-body-sm text-body-sm text-on-background placeholder:text-secondary focus:outline-none transition-colors"
      />
      <button
        type="button"
        disabled={sending || !line.trim()}
        onClick={() => {
          setSending(true);
          submitLine(stage);
        }}
        className="font-label-sm text-label-sm text-primary hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40 transition-opacity"
      >
        Send
      </button>
      <button
        type="button"
        onClick={() => submitLine(stage)}
        className="font-label-sm text-label-sm text-secondary hover:text-on-background transition-colors"
      >
        Skip
      </button>
    </div>
  );
}
