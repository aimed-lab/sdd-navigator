"use client";

// The three small forms of the Service Providers directory, each opened from a
// button in a dialog: request a quote, claim a page, list your services. They
// share one dialog (sign-in gate when signed out, the form, then the thank-you
// line). Validation lives in lib/server/providers/validate.ts and runs again in
// the Server Actions; this only shows the messages.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  claimPageAction,
  listServicesAction,
  requestQuoteAction,
  type ProviderActionResult,
} from "@/app/collaborate/providers/actions";
import { LIMITS, TIMELINES } from "@/lib/server/providers/validate";

type Field = {
  name: string;
  label: string;
  kind: "text" | "email" | "textarea" | "select";
  optional?: boolean;
  placeholder?: string;
  max: number;
  options?: readonly string[];
};

const INPUT =
  "w-full glass-panel rounded-xl p-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary";

function Dialog({
  title,
  subtitle,
  signedIn,
  signInText,
  fields,
  submitLabel,
  submit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  signedIn: boolean;
  signInText: string;
  fields: Field[];
  submitLabel: string;
  submit: (values: Record<string, string>) => Promise<ProviderActionResult>;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    const res = await submit(values);
    if (res.ok) setDone(res.message);
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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-outline-variant/30">
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">{title}</h2>
            {subtitle && <p className="mt-1 font-body-sm text-body-sm text-secondary">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1 rounded-full text-secondary hover:bg-surface-container-low transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {!signedIn && (
          <div className="p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">lock</span>
            <h3 className="mt-3 font-headline-md text-lg text-on-background">{signInText}</h3>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
              className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              {signInText}
            </Link>
          </div>
        )}

        {signedIn && done && (
          <div className="p-8 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">check_circle</span>
            <p className="mt-3 font-body-lg text-body-lg text-on-background">{done}</p>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Done
            </button>
          </div>
        )}

        {signedIn && !done && (
          <form onSubmit={send} className="p-6 space-y-4">
            {fields.map((f) => {
              const id = `pf-${f.name}`;
              const value = values[f.name] ?? "";
              const set = (v: string) => setValues((s) => ({ ...s, [f.name]: v }));
              return (
                <div key={f.name}>
                  <label htmlFor={id} className="block font-label-md text-label-md text-on-background mb-1.5">
                    {f.label}
                    {f.optional && <span className="text-secondary font-body-sm"> (optional)</span>}
                  </label>
                  {f.kind === "textarea" ? (
                    <textarea
                      id={id}
                      rows={4}
                      value={value}
                      maxLength={f.max}
                      placeholder={f.placeholder}
                      onChange={(e) => set(e.target.value)}
                      className={INPUT}
                    />
                  ) : f.kind === "select" ? (
                    <select id={id} value={value} onChange={(e) => set(e.target.value)} className={INPUT}>
                      <option value="">Choose…</option>
                      {f.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={f.kind}
                      value={value}
                      maxLength={f.max}
                      placeholder={f.placeholder}
                      onChange={(e) => set(e.target.value)}
                      className={INPUT}
                    />
                  )}
                </div>
              );
            })}

            {error && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-lg font-label-md text-label-md text-secondary hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="btn-primary px-6 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-60"
              >
                {sending ? "Sending…" : submitLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function useOpen() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

export function QuoteButton({
  slug,
  company,
  signedIn,
}: {
  slug: string;
  company: string;
  signedIn: boolean;
}) {
  const { open, show, hide } = useOpen();
  const pathname = usePathname();
  const cls =
    "btn-outline w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-label-md text-label-md";
  // Signed out: the button itself is the sign-in link.
  if (!signedIn) {
    return (
      <Link href={`/login?callbackUrl=${encodeURIComponent(pathname)}`} className={cls}>
        Sign in to request a quote
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={show} className={cls}>
        Request a quote
      </button>
      {open && (
        <Dialog
          title={`Request a quote from ${company}`}
          subtitle="The SPARC team will pass this on and connect you."
          signedIn
          signInText="Sign in to request a quote"
          submitLabel="Send request"
          onClose={hide}
          fields={[
            { name: "need", label: "What do you need?", kind: "textarea", max: LIMITS.need, placeholder: "The work, the scale, anything that matters" },
            { name: "timeline", label: "Timeline", kind: "select", max: 50, options: TIMELINES },
            { name: "budget", label: "Budget range", kind: "text", optional: true, max: LIMITS.budget, placeholder: "e.g. $20k to $50k" },
            { name: "message", label: "Message", kind: "textarea", optional: true, max: LIMITS.message },
          ]}
          submit={(v) => requestQuoteAction(slug, v)}
        />
      )}
    </>
  );
}

export function ClaimButton({
  slug,
  company,
  signedIn,
}: {
  slug: string;
  company: string;
  signedIn: boolean;
}) {
  const { open, show, hide } = useOpen();
  const pathname = usePathname();
  const cls = "font-label-md text-label-md text-primary hover:underline underline-offset-4";
  if (!signedIn) {
    return (
      <Link href={`/login?callbackUrl=${encodeURIComponent(pathname)}`} className={cls}>
        Sign in to claim this page
      </Link>
    );
  }
  return (
    <>
      <button type="button" onClick={show} className={cls}>
        Claim this page
      </button>
      {open && (
        <Dialog
          title={`Claim the ${company} page`}
          subtitle="We'll check you work there before anything changes."
          signedIn
          signInText="Sign in to claim this page"
          submitLabel="Send claim"
          onClose={hide}
          fields={[
            { name: "name", label: "Your name", kind: "text", max: LIMITS.person },
            { name: "role", label: "Your role", kind: "text", max: LIMITS.role },
            { name: "work_email", label: "Work email", kind: "email", max: LIMITS.email },
            { name: "note", label: "Note", kind: "textarea", optional: true, max: LIMITS.note },
          ]}
          submit={(v) => claimPageAction(slug, v)}
        />
      )}
    </>
  );
}

export function ListServicesButton({ signedIn }: { signedIn: boolean }) {
  const { open, show, hide } = useOpen();
  return (
    <>
      <button
        type="button"
        onClick={show}
        className="btn-outline shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-label-md text-label-md"
      >
        Are you a provider? List your services
      </button>
      {open && (
        <Dialog
          title="List your services"
          subtitle="Tell us about your company. The SPARC team reviews every request."
          signedIn={signedIn}
          signInText="Sign in to list your services"
          submitLabel="Send"
          onClose={hide}
          fields={[
            { name: "company", label: "Company", kind: "text", max: LIMITS.company },
            { name: "website", label: "Website", kind: "text", max: LIMITS.website, placeholder: "https://" },
            { name: "contact_name", label: "Contact name", kind: "text", max: LIMITS.person },
            { name: "email", label: "Email", kind: "email", max: LIMITS.email },
            { name: "offer", label: "What you offer", kind: "textarea", max: LIMITS.offer },
          ]}
          submit={(v) => listServicesAction(v)}
        />
      )}
    </>
  );
}
