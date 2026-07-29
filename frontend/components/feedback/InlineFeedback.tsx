"use client";

// One quiet line of text that expands into a textarea IN PLACE. No modal, no
// navigation, no rating, no redirect after submit — just the line replaced by
// a plain thank-you. This is the shape used at the bottom of /explore,
// /collaborate and /promote (each with its own prompt) and for the optional
// follow-up on an empty /explore/[topic] search.
//
// Works signed out: user_id is attached server-side (submitFeedbackAction ->
// lib/server/feedback.ts) from whatever session exists, or left null. This
// component never checks auth state and never requires one.

import { useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedbackAction } from "@/app/feedback/actions";

export default function InlineFeedback({
  prompt,
  pagePath,
  context,
}: {
  /** Shown as the quiet line, then reused as the textarea's label once open. */
  prompt: string;
  /** Defaults to the current route when omitted. */
  pagePath?: string;
  context?: Record<string, unknown>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (sending || !message.trim()) return;
    setSending(true);
    await submitFeedbackAction({
      page_path: pagePath ?? pathname ?? "",
      message: message.trim(),
      context: context ?? {},
    });
    setSending(false);
    setSent(true);
  };

  if (sent) {
    return (
      <p className="text-center font-body-sm text-body-sm text-secondary py-2">
        Thanks — this helps.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="text-center py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-body-sm text-body-sm text-secondary hover:text-primary underline underline-offset-4 transition-colors"
        >
          {prompt}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-2 space-y-3">
      <label className="block font-label-sm text-label-sm text-secondary">{prompt}</label>
      <textarea
        autoFocus
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type here…"
        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMessage("");
          }}
          disabled={sending}
          className="font-label-md text-label-md text-secondary hover:text-on-background transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={send}
          disabled={sending || !message.trim()}
          className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
