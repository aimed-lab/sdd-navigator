"use client";

// Shared form primitives for the profile editor (onboarding + settings).
//
// One copy so the two pages can't drift: they are the same form in two framings
// (a guided first run vs. a section you return to). Visual language follows
// design/stitch/smartdrugdiscovery_profile_setup_flow — white cards on the page
// background, section heading with a leading icon, understated helper text.

import { useState } from "react";

export const inputCls =
  "w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant " +
  "font-body-md text-body-md text-on-surface outline-none transition-all " +
  "focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "placeholder:text-on-surface-variant/40";

export const labelCls = "block font-label-sm text-label-sm text-on-surface mb-2";

export function Card({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel rounded-2xl p-6 md:p-8">
      <h2 className="flex items-center gap-2 font-headline-md text-lg text-on-background">
        <span className="material-symbols-outlined text-primary">{icon}</span>
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1.5 font-body-sm text-body-sm text-secondary">{subtitle}</p>
      )}
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 font-body-sm text-body-sm text-secondary">{hint}</p>}
    </div>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: React.ReactNode;
}) {
  const error = kind === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={
        "flex items-start gap-2 p-3 rounded-lg border font-body-md text-body-md " +
        (error
          ? "bg-error-container border-error/20 text-on-error-container"
          : "bg-secondary-container border-primary/20 text-on-secondary-container")
      }
    >
      <span className="material-symbols-outlined text-[20px]">
        {error ? "error" : "check_circle"}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <p className="font-label-md text-label-md text-on-background">{label}</p>
        {description && (
          <p className="mt-1 font-body-sm text-body-sm text-secondary">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={
          "relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-50 " +
          (checked ? "bg-primary" : "bg-surface-container-high")
        }
      >
        <span
          className={
            "absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform " +
            (checked ? "translate-x-6" : "translate-x-1")
          }
        />
      </button>
    </div>
  );
}

/** Editable tag chips. Enter or comma commits; Backspace on an empty input
 *  removes the last chip (the behaviour people expect from a chip field). */
export function ChipInput({
  values,
  onChange,
  placeholder = "Add one and press Enter",
  max = 20,
  ariaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const v = raw.trim().slice(0, 60);
    if (!v) return;
    // Case-insensitive dedupe: "PHGDH" and "phgdh" are the same interest.
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    if (values.length >= max) return;
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="hover:text-on-background transition-colors"
            >
              <span className="material-symbols-outlined text-base leading-none">close</span>
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="font-body-sm text-body-sm text-secondary">Nothing added yet.</span>
        )}
      </div>

      <input
        type="text"
        value={draft}
        aria-label={ariaLabel}
        placeholder={values.length >= max ? `Limit of ${max} reached` : placeholder}
        disabled={values.length >= max}
        onChange={(e) => {
          // A pasted "a, b, c" commits each entry rather than one long chip.
          if (e.target.value.includes(",")) {
            const parts = e.target.value.split(",");
            const last = parts.pop() ?? "";
            parts.forEach(add);
            setDraft(last);
          } else {
            setDraft(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault(); // never submit the surrounding form
            add(draft);
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        className={inputCls + " disabled:opacity-60"}
      />
    </div>
  );
}
