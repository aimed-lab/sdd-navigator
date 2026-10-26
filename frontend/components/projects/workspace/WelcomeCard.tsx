"use client";

// The Welcome card on a ColaboFest project's Overview, shown until this person
// presses "Dismiss" (stored per person and project in the database). The dates
// and labels come from lib/colabofestConfig.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dismissWelcomeAction } from "@/app/projects/[id]/actions";
import { COLABOFEST_SHOWCASE_NAME, COLABOFEST_STAGES, currentStageIndex } from "@/lib/colabofestConfig";

const STEPS = [
  { n: 1, text: "Open your Box folder" },
  { n: 2, text: "Look at your SPARC checklist and the next due date" },
  { n: 3, text: "Say hello in Discussions" },
];

export default function WelcomeCard({ projectId, firstName, today }: { projectId: string; firstName: string; today: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = currentStageIndex(today);
  if (hidden) return null;

  const dismiss = async () => {
    setError(null);
    setHidden(true);
    const res = await dismissWelcomeAction(projectId);
    if (res.ok) router.refresh();
    else {
      setHidden(false);
      setError(res.error);
    }
  };

  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6 flex flex-col gap-4" aria-label="Welcome">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-title text-[22px] leading-snug font-medium text-on-background">
          Welcome to your ColaboFest project, {firstName}
        </h2>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 font-label-sm text-label-sm text-secondary hover:text-primary"
          aria-label="Dismiss the welcome card"
        >
          Dismiss ✕
        </button>
      </div>
      <p className="font-body-md text-body-md text-secondary">
        This page is your team&apos;s home until the {COLABOFEST_SHOWCASE_NAME}. Everything you need is here: your files, deadlines,
        announcements and your SPARC and Southern Research contacts.
      </p>

      <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-xl bg-white border border-outline-variant/30 px-4 py-3 flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-on-primary font-label-sm text-label-sm flex items-center justify-center">
              {s.n}
            </span>
            <span className="font-body-md text-body-md text-on-background">{s.text}</span>
          </li>
        ))}
      </ol>

      <ol className="grid grid-cols-4 gap-1 pt-1" aria-label="Program dates">
        {COLABOFEST_STAGES.map((st, i) => {
          const on = i === current;
          return (
            <li key={st.key} className="flex flex-col items-center text-center gap-1" aria-current={on ? "step" : undefined}>
              <span className={"w-3 h-3 rounded-full " + (on ? "bg-primary ring-4 ring-primary/20" : i < current ? "bg-primary/50" : "bg-outline-variant")} />
              <span className={"font-label-sm text-label-sm leading-tight " + (on ? "text-primary font-semibold" : "text-secondary")}>{st.label}</span>
              <span className={"font-body-sm text-body-sm " + (on ? "text-primary" : "text-secondary")}>{st.shown}</span>
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
