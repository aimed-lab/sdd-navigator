"use client";

// The persistent, "anything at all, any time" feedback widget — a small
// floating button, bottom-right, mounted ONCE in the root layout so it's
// available on every page, not just /explore, /collaborate, /promote and a
// project page. It used to be a full-width card each of those pages placed
// itself at the bottom of its content; that card is gone, replaced by this
// corner button + a small panel, same idiom as ProjectChatbot
// (components/projects/ProjectChatbot.tsx) — fixed, out of normal flow, so
// opening it never reflows the page underneath.
//
// COEXISTS WITH THE PROJECT CHATBOT, DOESN'T MERGE WITH IT: the chatbot
// answers questions about ONE project from data already on the page; this
// asks the visitor a question about how the page/site is doing, on every
// route including ones with no project at all. Different purpose, so a
// separate button.
//
// STACKED, NOT SIDE-BY-SIDE: two buttons next to each other in the same
// corner read as one thing with an accessory bolted on. Stacked vertically
// in the same corner reads as two independent, equally-weighted controls —
// chat closest to the corner (it's the one with a persistent, obviously
// project-scoped purpose), feedback directly above it. SAME_SIZE_PX /
// STACK_GAP_PX below are the numbers that keep the two buttons pixel-exact
// twins and the stacking math (this file computes its own offset; chat's
// own base offset in ProjectChatbot is untouched) in one place, since a
// project page mounts both of these as two independent components with no
// shared parent to coordinate them otherwise. isProjectRoute detects
// whether THIS route is one where ProjectChatbot mounts itself
// (app/projects/[id]/page.tsx) — the only page type where stacking is
// needed at all; everywhere else feedback sits alone in the corner.
//
// LABELS ARE ALWAYS VISIBLE, NOT HOVER-ONLY: the ask is "a first-time user
// knows what it does without clicking" — hover satisfies that on desktop
// but tells a touch-screen visitor nothing until they've already tapped,
// which is the exact moment the label was supposed to help. An always-on
// label costs a wider pill instead of a bare circle; that's a fair trade
// for working the same way on every input method.
//
// SUBJECT is still specific per route, not a generic "this page" — losing
// "these search results" / "the Collaborate board" would make the opening
// question read as if it wasn't really asking about anything. Since this is
// one instance mounted in the root layout rather than one call per page,
// the mapping happens here off the pathname instead of being passed in as
// a prop.
//
// Still asks the three things worth knowing, one at a time, each optional
// past the first tap:
//
//   1. Was <subject> useful?          — one tap, yes/no
//   2. What were you expecting that
//      you did not find?              — one line, optional
//   3. Anything else?                 — one line, optional
//
// APPEND-ONLY, same pattern as AgentSection's run-feedback widget: the tap
// is one row, each sentence (if the visitor bothers to type one) is
// another. `feedback` has no UPDATE policy (see
// database/migrations/2026-07-29_feedback.sql).
//
// ONE QUESTION AT A TIME, NOT ALL THREE FIELDS AT ONCE — asked to read as a
// question someone is asking, not a survey.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedbackAction } from "@/app/feedback/actions";

type Stage = "tap" | "expected" | "other" | "done";

// Kept as named constants (not just Tailwind classes) because the stacking
// offset below has to do the same arithmetic in JS as the classes do in
// CSS — h-14 (56px) and gap-3 (12px), spelled out so the two never drift
// apart silently.
const BUTTON_PX = 56;
const STACK_GAP_PX = 12;
const CORNER_GAP_PX = 24;

/** True on the one route where ProjectChatbot mounts its own floating
 *  button (app/projects/[id]/page.tsx) — the only place stacking is
 *  needed. Everywhere else feedback sits alone in the corner. */
function isProjectRoute(pathname: string): boolean {
  return /^\/projects\/[^/]+/.test(pathname);
}

/** Route-specific noun phrase for "Was {subject} useful?", plus any extra
 *  context to ride along on every row this widget writes — mirrors what
 *  each page used to pass as props. Longest-prefix match against the
 *  current pathname; a project page also gets its id into `context` (its
 *  name isn't derivable from the URL, so it's left out here — page_path
 *  already identifies the project uniquely). */
function subjectFor(pathname: string): { subject: string; context?: Record<string, unknown> } {
  if (pathname === "/explore" || pathname.startsWith("/explore/")) {
    return { subject: "these search results" };
  }
  if (pathname === "/collaborate" || pathname.startsWith("/collaborate/")) {
    return { subject: "the Collaborate board" };
  }
  if (pathname === "/promote" || pathname.startsWith("/promote/")) {
    return { subject: "this page" };
  }
  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (projectMatch) {
    return { subject: "this project", context: { project_id: projectMatch[1] } };
  }
  return { subject: "this page" };
}

/** Same footer-clearance idiom as ProjectChatbot's own hook — lifts the
 *  button off the bottom of the viewport by however much of the footer is
 *  currently visible, plus the usual gap, instead of ever sitting on top
 *  of it. Duplicated rather than shared: two small, independent floating
 *  widgets, each free to evolve its own offset without coupling them. */
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

export default function GeneralFeedback() {
  const pathname = usePathname() ?? "";
  const { subject, context } = subjectFor(pathname);
  const footerClearance = useFooterClearance();
  const stacked = isProjectRoute(pathname);

  // Bottom offset of THIS button — same corner offset chat uses, plus one
  // more button-height-and-gap when chat is also on screen underneath it.
  const buttonBottom = CORNER_GAP_PX + footerClearance + (stacked ? BUTTON_PX + STACK_GAP_PX : 0);
  // The open panel anchors from wherever this button actually is, not a
  // fixed guess — it replaces the button, so it opens from the same spot,
  // lifted clear of it by one more button-height-and-gap.
  const panelBottom = buttonBottom + BUTTON_PX + STACK_GAP_PX;

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("tap");
  const [useful, setUseful] = useState<boolean | null>(null);
  const [line, setLine] = useState("");
  const [sending, setSending] = useState(false);

  const send = (extra: Record<string, unknown>, message: string | null) => {
    // Fire-and-forget, like every other feedback write in this app — this
    // widget must never block on the network, and a failed insert must
    // never surface to the visitor.
    submitFeedbackAction({
      page_path: pathname,
      message,
      context: { kind: "general_feedback", ...context, ...extra },
    }).catch(() => {});
  };

  const reset = () => {
    setStage("tap");
    setUseful(null);
    setLine("");
    setSending(false);
  };

  const close = () => {
    setOpen(false);
    // Next open starts a fresh question, on this page or whichever the
    // visitor is on by then — never resumes a stale in-progress answer.
    reset();
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
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Give feedback"
          style={{ bottom: `${buttonBottom}px`, height: `${BUTTON_PX}px` }}
          className="fixed right-6 z-[55] px-4 rounded-full bg-surface-container-lowest text-on-background border border-outline-variant/50 shadow-lg flex items-center gap-2 hover:bg-surface-container-low transition-colors"
        >
          <span className="material-symbols-outlined text-[22px]">edit_note</span>
          <span className="font-label-sm text-label-sm">Feedback</span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Feedback"
          style={{ bottom: `${panelBottom}px` }}
          className="fixed right-3 sm:right-6 left-3 sm:left-auto z-[60] w-auto sm:w-[360px] rounded-2xl bg-surface-container-lowest shadow-2xl border border-outline-variant/30 p-5"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="font-label-md text-label-md text-on-background font-semibold">Feedback</p>
            <button
              type="button"
              onClick={close}
              aria-label="Close feedback"
              className="shrink-0 w-7 h-7 -mt-1 -mr-1 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-background transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {stage === "done" && (
            <p className="font-body-sm text-body-sm text-on-background">Thanks — this helps.</p>
          )}

          {stage === "tap" && (
            <div className="space-y-3">
              <p className="font-body-sm text-body-sm text-on-background">
                Was {subject} useful?
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => tap(true)}
                  className="btn-outline px-5 py-2 rounded-lg font-label-sm text-label-sm"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => tap(false)}
                  className="btn-outline px-5 py-2 rounded-lg font-label-sm text-label-sm"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {/* "expected" and "other" — one optional line, Enter or Send
              fires it, Skip moves on without writing anything for this
              one. */}
          {(stage === "expected" || stage === "other") && (
            <div className="space-y-2">
              <label className="block font-body-sm text-body-sm text-on-background">
                {stage === "expected" ? "What were you expecting that you did not find?" : "Anything else?"}
              </label>
              <div className="flex items-center gap-2">
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
                  placeholder="Type here…"
                  className="flex-1 bg-surface-container-low border border-outline-variant/40 rounded-lg px-3 py-2 font-body-sm text-body-sm text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  type="button"
                  disabled={sending || !line.trim()}
                  onClick={() => {
                    setSending(true);
                    submitLine(stage);
                  }}
                  className="btn-primary px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              <button
                type="button"
                onClick={() => submitLine(stage)}
                className="font-label-sm text-label-sm text-secondary hover:text-on-background transition-colors"
              >
                Skip
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
