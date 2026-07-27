"use client";

// Connect modal — the response flow for a board post. Layout follows
// design/stitch/smartdrugdiscovery_connect_modal, restyled in the shared design
// system.
//
// Signed out, the modal shows a sign-in prompt instead of the form. That's a
// convenience only: respondAction re-checks on the server, so a crafted call
// still fails (and RLS fails it again at the database).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { respondAction } from "@/app/collaborate/actions";
import { CONTACT_MAX, type InterestType } from "@/lib/collabTypes";

// The four schema values, with wording a researcher would actually recognise.
// The design showed three; want_to_use is the fourth the data model defines.
const CHOICES: { value: InterestType; label: string; hint: string; icon: string }[] = [
  {
    value: "can_provide",
    label: "I can provide something you need",
    hint: "You have a resource, method or capability from their “seeking” list.",
    icon: "volunteer_activism",
  },
  {
    value: "want_to_join",
    label: "I want to join this project",
    hint: "You'd like to be part of the team or a co-investigator.",
    icon: "group_add",
  },
  {
    value: "want_to_use",
    label: "I'd like to use what you're offering",
    hint: "You want access to a resource or service they listed.",
    icon: "handyman",
  },
  {
    value: "general",
    label: "General interest",
    hint: "You'd just like to start a conversation.",
    icon: "chat_bubble",
  },
];

export default function ConnectModal({
  postId,
  postTitle,
  signedIn,
  onClose,
}: {
  postId: string;
  postTitle: string;
  signedIn: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [choice, setChoice] = useState<InterestType>("general");
  const [message, setMessage] = useState("");
  // Self-provided contact. Deliberately NOT prefilled from the account email:
  // the whole point is that the responder chooses what to share, per response.
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes; focus lands in the dialog for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);

    const res = await respondAction({
      post_id: postId,
      interest_type: choice,
      message: message.trim(),
      contact: contact.trim(),
    });

    if (res.ok) setSent(true);
    else setError(res.error);
    setSending(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Connect about ${postTitle}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-outline-variant/30">
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">Connect</h2>
            <p className="mt-1 font-body-sm text-body-sm text-secondary line-clamp-2">
              {postTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1 rounded-full text-secondary hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Signed out → gate */}
        {!signedIn && (
          <div className="p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">lock</span>
            <h3 className="mt-3 font-headline-md text-lg text-on-background">
              Sign in to respond
            </h3>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              You need an account so the post owner knows who&apos;s reaching out.
            </p>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
              className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Sign in to respond
            </Link>
          </div>
        )}

        {/* Sent → confirmation */}
        {signedIn && sent && (
          <div className="p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">check_circle</span>
            <h3 className="mt-3 font-headline-md text-lg text-on-background">Request sent</h3>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              The post owner can see your interest and will respond through the platform.
            </p>
            <button
              onClick={onClose}
              className="btn-primary mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Done
            </button>
          </div>
        )}

        {/* Signed in → the form */}
        {signedIn && !sent && (
          <form onSubmit={submit} className="p-6 space-y-6">
            <fieldset className="space-y-3">
              <legend className="font-label-sm text-label-sm text-secondary uppercase mb-3">
                How would you like to connect?
              </legend>
              {CHOICES.map((c) => {
                const active = choice === c.value;
                return (
                  <label
                    key={c.value}
                    className={
                      "flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all " +
                      (active
                        ? "border-primary bg-primary/5"
                        : "border-outline-variant/40 hover:bg-surface-container-low")
                    }
                  >
                    <input
                      type="radio"
                      name="interest_type"
                      value={c.value}
                      checked={active}
                      onChange={() => setChoice(c.value)}
                      className="sr-only"
                    />
                    <span
                      className={
                        "material-symbols-outlined shrink-0 " +
                        (active ? "text-primary" : "text-secondary")
                      }
                    >
                      {c.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-label-md text-label-md text-on-background">
                        {c.label}
                      </span>
                      <span className="block font-body-sm text-body-sm text-secondary mt-0.5">
                        {c.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <div>
              <label
                htmlFor="connect-message"
                className="block font-label-md text-label-md text-on-background mb-2"
              >
                Message <span className="text-secondary font-body-sm">(optional)</span>
              </label>
              <textarea
                id="connect-message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Briefly say what you'd bring or what you're after…"
                className="w-full glass-panel rounded-xl p-4 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Self-provided contact. The post owner sees exactly this string and
                nothing else — no account email is ever shared for them. */}
            <div>
              <label
                htmlFor="connect-contact"
                className="block font-label-md text-label-md text-on-background mb-2"
              >
                How can they reach you?{" "}
                <span className="text-secondary font-body-sm">(optional)</span>
              </label>
              <input
                id="connect-contact"
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                maxLength={CONTACT_MAX}
                placeholder="e.g. j.smith@uab.edu, or a lab phone, or @handle"
                className="w-full glass-panel rounded-xl p-4 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <p className="mt-2 font-body-sm text-body-sm text-secondary">
                Shared only with this post&apos;s owner. We never share your
                account email — if you leave this blank, they&apos;ll see your name
                but have no way to reply.
              </p>
            </div>

            {error && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
