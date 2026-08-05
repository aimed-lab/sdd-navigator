"use client";

// Create-project form. Layout follows frontend/design/projects/STRUCTURE.md,
// screens 2 and 3 — the same form serves both entry points, distinguished by
// the `colabofest` prop:
//   - from "New project" (colabofest=false): heading "Create a project",
//     shows the collapsed "Entering a challenge?" disclosure.
//   - from the ColaboFest banner (colabofest=true): heading "Start your
//     ColaboFest project" + a ColaboFest pill, no challenge disclosure (this
//     entry point already implies challenge_key = 'colabofest_2026').
//
// Only rendered for a signed-in user — app/projects/new/page.tsx redirects to
// /login otherwise. createProjectAction re-checks server-side regardless.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProjectAction } from "@/app/projects/actions";
import { MODALITIES, MODALITY_LABEL, PROJECT_STAGES, PROJECT_STAGE_LABEL } from "@/lib/projectTypes";

const UNSET = "" as const;

export default function CreateProjectForm({ colabofest }: { colabofest: boolean }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [target, setTarget] = useState("");
  const [indication, setIndication] = useState("");
  const [modality, setModality] = useState<string>(UNSET);
  const [stage, setStage] = useState<string>(UNSET);
  const [challenge, setChallenge] = useState<string>(UNSET);
  const [challengeOpen, setChallengeOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!name.trim()) {
      setError("A project name is required.");
      return;
    }
    if (!description.trim()) {
      setError("Tell us what you're working on.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await createProjectAction({
      name,
      description,
      deadline: deadline || undefined,
      colabofest,
      challenge: challenge || undefined,
      target: target || undefined,
      indication: indication || undefined,
      modality: modality || undefined,
      stage: stage || undefined,
    });

    if (res.ok) {
      // /projects/[id] is step 2 (not built yet, per STRUCTURE.md) — land
      // back on the list, which will show the new project immediately since
      // its project_members row (role 'lead') was just created alongside it.
      router.push("/projects");
      router.refresh();
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-surface-container-low border border-surface-dim rounded-lg px-4 py-3 font-body-md text-body-md text-on-background focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none";

  return (
    <form
      onSubmit={submit}
      className="glass-card rounded-xl p-8 md:p-12 flex flex-col gap-8 max-w-[600px] w-full mx-auto"
    >
      <header className="text-center">
        <h1 className="font-headline-lg text-headline-lg md:text-display-lg md:font-display-lg text-primary">
          {colabofest ? "Start your ColaboFest project" : "Create a project"}
        </h1>
        {colabofest && (
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary-container/20 text-primary font-label-sm text-label-sm mt-2">
            ColaboFest
          </span>
        )}
        <p className="mt-2 font-body-md text-body-md text-secondary">
          Initialize a new workspace for your pharmaceutical research.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="font-label-md text-label-md text-on-surface-variant">
            Project name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kinase Inhibitor Screening"
            className={inputClass}
          />
        </div>

        {/* Programme details (optional) — see
            database/migrations/2026-08-05_projects_program_details.sql; every
            field here is nullable, no default, and its own row can be left
            entirely blank. */}
        <div className="flex flex-col gap-4 p-4 bg-surface-container-low/30 rounded-lg border border-surface-dim/50">
          <h3 className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">
            Programme details (optional)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="target" className="font-label-md text-label-md text-on-surface-variant">
                Target
              </label>
              <input
                id="target"
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. KRAS G12D, PHGDH"
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="indication"
                className="font-label-md text-label-md text-on-surface-variant"
              >
                Indication
              </label>
              <input
                id="indication"
                type="text"
                value={indication}
                onChange={(e) => setIndication(e.target.value)}
                placeholder="e.g. pancreatic cancer"
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="modality" className="font-label-md text-label-md text-on-surface-variant">
                Modality
              </label>
              <select
                id="modality"
                value={modality}
                onChange={(e) => setModality(e.target.value)}
                className={`${inputClass} appearance-none cursor-pointer`}
              >
                <option value={UNSET}>—</option>
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {MODALITY_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="stage" className="font-label-md text-label-md text-on-surface-variant">
                Stage
              </label>
              <select
                id="stage"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className={`${inputClass} appearance-none cursor-pointer`}
              >
                <option value={UNSET}>—</option>
                {PROJECT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="description" className="font-label-md text-label-md text-on-surface-variant">
            What are you working on?
          </label>
          <textarea
            id="description"
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your research goal, target protein, or therapeutic area..."
            className={`${inputClass} resize-none`}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="deadline" className="font-label-md text-label-md text-on-surface-variant flex items-center gap-2">
            Deadline <span className="font-body-sm text-body-sm text-secondary">(optional)</span>
          </label>
          <input
            id="deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* "Entering a challenge?" — only on the plain "New project" entry
            point. The ColaboFest-banner entry point already implies
            challenge_key, so there is nothing here to choose. */}
        {!colabofest && (
          <div className="border border-surface-dim rounded-lg p-4 bg-surface-container-lowest/50">
            <button
              type="button"
              onClick={() => setChallengeOpen((o) => !o)}
              className="w-full flex items-center justify-between text-left group"
            >
              <span className="font-label-md text-label-md text-primary flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">emoji_events</span>
                Entering a challenge?
              </span>
              <span
                className="material-symbols-outlined text-secondary transition-transform duration-300"
                style={{ transform: challengeOpen ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                expand_more
              </span>
            </button>
            {challengeOpen && (
              <div className="flex flex-col gap-2 mt-4">
                <label htmlFor="challenge" className="sr-only">
                  Select a challenge
                </label>
                <select
                  id="challenge"
                  value={challenge}
                  onChange={(e) => setChallenge(e.target.value)}
                  className={`${inputClass} appearance-none cursor-pointer`}
                >
                  <option value={UNSET}>None</option>
                  <option value="colabofest2026">ColaboFest 2026</option>
                </select>
                <p className="font-body-sm text-body-sm text-secondary mt-1">
                  Linking a challenge applies specific formatting and evaluation
                  criteria.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <footer className="flex flex-col gap-4">
        <button
          type="submit"
          disabled={saving}
          className="w-full btn-primary py-3.5 px-6 rounded-lg font-label-md text-label-md flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create project"}
          {!saving && <span className="material-symbols-outlined text-[18px]">arrow_forward</span>}
        </button>
        <Link
          href="/projects"
          className="w-full text-center font-label-md text-label-md text-secondary hover:text-primary transition-colors py-2"
        >
          Cancel
        </Link>
      </footer>
    </form>
  );
}
