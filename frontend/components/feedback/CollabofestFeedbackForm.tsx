"use client";

// Landing-page Collabofest capture: "Thinking about a submission? Tell us
// what would help." A textarea plus an OPTIONAL email field, distinct from
// InlineFeedback because this section is a standing invitation, not a quiet
// collapsed line — the landing page is often the only page a Thursday
// info-session visitor ever loads.
//
// Works signed out. user_id is attached server-side when a session exists;
// email here is the visitor's own choice to leave a reply address, not a
// substitute for one.

import { useState } from "react";
import { submitFeedbackAction } from "@/app/feedback/actions";

export default function CollabofestFeedbackForm() {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (sending || !message.trim()) return;
    setSending(true);
    await submitFeedbackAction({
      page_path: "/",
      message: message.trim(),
      email: email.trim() || null,
      context: { section: "collabofest" },
    });
    setSending(false);
    setSent(true);
  };

  if (sent) {
    return (
      <div className="glass-panel rounded-xl p-6 text-center">
        <p className="font-body-md text-body-md text-on-background">
          Thanks — this helps us plan the Collabofest.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-6 space-y-4">
      <h3 className="font-headline-md text-headline-md text-on-background">
        Thinking about a submission? Tell us what would help.
      </h3>
      <textarea
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What would help you put a proposal together?"
        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email — only if you want a reply"
          aria-label="Email — only if you want a reply"
          className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={send}
          disabled={sending || !message.trim()}
          className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
