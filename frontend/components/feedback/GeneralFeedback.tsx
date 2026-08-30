"use client";

// The persistent, page-scoped "anything at all, any time" feedback box —
// used at the bottom of /explore, /collaborate, /promote, and a project
// page. NOT InlineFeedback: that component is a single blank textarea, and
// a blank box gets nothing — nobody knows what to write in it. This asks
// the three things actually worth knowing, one at a time, each optional
// past the first tap:
//
//   1. Was <subject> useful to you?   — one tap, yes/no
//   2. What were you expecting that
//      you did not find?              — one line, optional
//   3. Anything else?                 — one line, optional
//
// SAYS WHAT "THIS" IS. A visitor who scrolled past a feed and hits a bare
// "was this useful?" has no idea what "this" refers to — the search? the
// page? the whole site? `subject` is a caller-supplied noun phrase
// ("these search results", "the Collaborate board", "this project") so the
// question names the actual thing it's asking about, the same way each
// page used to write its own InlineFeedback prompt.
//
// PRESENCE: same glass-panel/rounded-2xl card the rest of the app uses for
// a standing section (see CollabofestFeedbackForm, AgentSection's own
// panels) — not bare centred text floating between the content and the
// footer. Full-width content-column padding, real buttons, not a thin pill.
//
// PLACEMENT (decided by each caller, not this component): immediately
// after the primary content, in the SAME rhythm as the sections above it
// (no isolating divider, no extra dead space) — right where a researcher
// who just finished reading is, not shoved down into the quiet gap above
// the footer where nothing gets read. See each page's own call site.
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
  subject,
  pagePath,
  context,
}: {
  /** Noun phrase naming what "this" is — "these search results", "the
   *  Collaborate board", "this project". Filled into "Was {subject} useful
   *  to you?" so the question names its own referent. */
  subject: string;
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

  return (
    <div className="glass-panel rounded-2xl p-6 md:p-8 max-w-2xl mx-auto text-center">
      {stage === "done" && (
        <p className="font-body-md text-body-md text-on-background">Thanks — this helps.</p>
      )}

      {stage === "tap" && (
        <div className="flex flex-wrap items-center justify-center gap-4">
          <span className="font-body-md text-body-md text-on-background">
            Was {subject} useful to you?
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => tap(true)}
              className="btn-outline px-6 py-2.5 rounded-lg font-label-md text-label-md"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => tap(false)}
              className="btn-outline px-6 py-2.5 rounded-lg font-label-md text-label-md"
            >
              No
            </button>
          </div>
        </div>
      )}

      {/* "expected" and "other" — one optional line, Enter or Send fires
          it, Skip moves on without writing anything for this one. */}
      {(stage === "expected" || stage === "other") && (
        <div className="max-w-md mx-auto flex items-center gap-2">
          <label className="sr-only">
            {stage === "expected" ? "What were you expecting that you did not find?" : "Anything else?"}
          </label>
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
            placeholder={
              stage === "expected" ? "What were you expecting that you did not find?" : "Anything else?"
            }
            className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            disabled={sending || !line.trim()}
            onClick={() => {
              setSending(true);
              submitLine(stage);
            }}
            className="btn-primary px-5 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => submitLine(stage)}
            className="font-label-md text-label-md text-secondary hover:text-on-background transition-colors px-2"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
