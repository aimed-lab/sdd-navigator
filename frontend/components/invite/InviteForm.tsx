"use client";

import { useState } from "react";
import { submitInviteAction } from "@/app/invite/actions";
import {
  INVITE_INTERESTS,
  INVITE_ROLES,
  validateInvite,
  type InviteFieldErrors,
} from "@/lib/inviteTypes";

const INPUT =
  "w-full rounded-[14px] border border-outline-variant/40 bg-white px-4 py-3 font-body-md text-body-md text-on-background " +
  "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary";
const LABEL = "block font-label-md text-label-md text-on-background mb-1.5";

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 font-body-sm text-body-sm text-error">
      {text}
    </p>
  );
}

export default function InviteForm({ initialInterest }: { initialInterest: string | null }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [interests, setInterests] = useState<string[]>(initialInterest ? [initialInterest] : []);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<InviteFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function toggleInterest(label: string) {
    setInterests((cur) => (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    // Where they came from: the referring page on this site, else the interest param.
    let source_page = "direct";
    try {
      if (document.referrer) {
        const ref = new URL(document.referrer);
        if (ref.origin === location.origin) source_page = ref.pathname;
      }
      if (initialInterest) source_page += ` (interest: ${initialInterest})`;
    } catch {
      /* keep "direct" */
    }

    const input = { name, email, organization, role, interests, message, source_page };
    const found = validateInvite(input);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const result = await submitInviteAction(input);
      if (result.ok) {
        setDone(true);
      } else {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        setFormError(result.error);
      }
    } catch {
      setFormError("We couldn't send your request. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="glass-panel p-8 md:p-10 text-center flex flex-col items-center gap-4"
      >
        <span className="material-symbols-outlined text-primary text-5xl">check_circle</span>
        <p className="font-title text-[24px] font-medium text-on-background">
          Thanks, we&apos;ll be in touch soon.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="glass-panel p-6 md:p-10 space-y-6"
    >
      <div>
        <label htmlFor="inv-name" className={LABEL}>
          Name <span className="text-error">*</span>
        </label>
        <input
          id="inv-name"
          className={INPUT}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={200}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "inv-name-err" : undefined}
        />
        <FieldError id="inv-name-err" text={errors.name} />
      </div>

      <div>
        <label htmlFor="inv-email" className={LABEL}>
          Email <span className="text-error">*</span>
        </label>
        <input
          id="inv-email"
          type="email"
          className={INPUT}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={320}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "inv-email-err" : undefined}
        />
        <FieldError id="inv-email-err" text={errors.email} />
      </div>

      <div>
        <label htmlFor="inv-org" className={LABEL}>
          Organization <span className="text-error">*</span>
        </label>
        <input
          id="inv-org"
          className={INPUT}
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          autoComplete="organization"
          maxLength={200}
          aria-invalid={!!errors.organization}
          aria-describedby={errors.organization ? "inv-org-err" : undefined}
        />
        <FieldError id="inv-org-err" text={errors.organization} />
      </div>

      <div>
        <label htmlFor="inv-role" className={LABEL}>
          I am <span className="text-error">*</span>
        </label>
        <select
          id="inv-role"
          className={INPUT}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-invalid={!!errors.role}
          aria-describedby={errors.role ? "inv-role-err" : undefined}
        >
          <option value="">Choose one</option>
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <FieldError id="inv-role-err" text={errors.role} />
      </div>

      <fieldset>
        <legend className={LABEL}>Interested in</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {INVITE_INTERESTS.map((i) => (
            <label
              key={i.key}
              className="flex items-center gap-3 rounded-lg border border-outline-variant/60 px-4 py-3 cursor-pointer hover:bg-surface-container-low font-body-md text-body-md text-on-background"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={interests.includes(i.label)}
                onChange={() => toggleInterest(i.label)}
              />
              {i.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="inv-msg" className={LABEL}>
          Message <span className="text-secondary font-body-sm">(optional)</span>
        </label>
        <textarea
          id="inv-msg"
          rows={4}
          className={INPUT}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
        />
      </div>

      {formError && (
        <p
          role="alert"
          className="rounded-lg bg-error-container text-on-error-container px-4 py-3 font-body-md text-body-md"
        >
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full sm:w-auto px-8 py-3 rounded-lg font-label-md text-lg disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Request invite code"}
      </button>
    </form>
  );
}
