"use client";

// Proposal section — frontend/design/projects/STRUCTURE.md, ColaboFest
// detail workspace, "Proposal Details". The PARENT page only renders this
// component at all when project.challenge_key is set — an ordinary project
// has no Proposal section, full stop, not an empty/disabled one.
//
// Both real rules here are enforced in lib/server/projects.ts, not in this
// component: only the lead may submit, and nothing may be saved or
// submitted once the deadline has passed. The disabling below is a UI
// courtesy that mirrors those rules for a good experience — every action
// still goes through the server function that checks for real, so a
// disabled button being force-clicked (or bypassed entirely) accomplishes
// nothing.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveProposalAction, submitProposalAction } from "@/app/projects/[id]/actions";
import type { ProjectProposal } from "@/lib/server/projects";

const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function fileNameOf(path: string): string {
  return path.split("/").pop() || path;
}

export default function ProposalSection({
  projectId,
  proposal,
  isLead,
  deadlinePassed,
  fileUrl,
}: {
  projectId: string;
  proposal: ProjectProposal | null;
  isLead: boolean;
  /** UI-only signal, mirroring the server's own deadline check — see the
   *  file header. Never trusted on its own. */
  deadlinePassed: boolean;
  /** Pre-resolved signed URL for proposal.file_path, or null if there's no
   *  file yet (or the signed-URL call failed) — resolved server-side by the
   *  page, since the bucket is private and a client can't mint its own. */
  fileUrl: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const submitted = !!proposal?.submitted_at;
  const [editing, setEditing] = useState(!submitted);

  const [title, setTitle] = useState(proposal?.title ?? "");
  const [category, setCategory] = useState(proposal?.category ?? "");
  const [summary, setSummary] = useState(proposal?.summary ?? "");

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = deadlinePassed; // saving/submitting both disabled once true

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || locked) return;
    setSaving(true);
    setError(null);

    const fd = new FormData(formRef.current as HTMLFormElement);
    const res = await saveProposalAction(projectId, fd);
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error);
    }
    setSaving(false);
  };

  const submit = async () => {
    if (submitting || locked) return;
    setSubmitting(true);
    setError(null);

    const res = await submitProposalAction(projectId);
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error);
    }
    setSubmitting(false);
  };

  const inputClass =
    "w-full bg-surface-container-lowest border border-outline-variant/50 rounded-lg p-3 font-body-md text-body-md text-on-background focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow shadow-sm disabled:opacity-60";

  return (
    <section className="mb-20">
      <h2 className="font-headline-md text-headline-md text-on-background mb-8">
        Proposal Details
      </h2>

      {locked && (
        <p className="mb-6 font-body-sm text-body-sm text-error">
          The deadline for this project has passed — the proposal can no longer be edited or
          submitted.
        </p>
      )}

      {/* Submitted, read-only summary — shown whenever submitted and not
          toggled into Edit. Edit is offered per spec, but a save attempt
          after submission is rejected server-side regardless (that's the
          real rule; this toggle is not). */}
      {submitted && !editing ? (
        <div className="glass-panel rounded-2xl p-8 flex flex-col gap-4 max-w-2xl">
          <div>
            <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">
              Title
            </span>
            <p className="font-body-md text-body-md text-on-background mt-1">
              {proposal?.title || "—"}
            </p>
          </div>
          {proposal?.category && (
            <div>
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">
                Category
              </span>
              <p className="font-body-md text-body-md text-on-background mt-1">
                {proposal.category}
              </p>
            </div>
          )}
          {proposal?.summary && (
            <div>
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">
                Summary
              </span>
              <p className="font-body-md text-body-md text-on-background mt-1 whitespace-pre-wrap">
                {proposal.summary}
              </p>
            </div>
          )}
          {proposal?.file_path && (
            <div>
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">
                Supporting document
              </span>
              <p className="mt-1">
                {fileUrl ? (
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-body-md text-body-md inline-flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[18px]">description</span>
                    {fileNameOf(proposal.file_path)}
                  </a>
                ) : (
                  <span className="font-body-md text-body-md text-secondary">
                    {fileNameOf(proposal.file_path)}
                  </span>
                )}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-4 border-t border-outline-variant/30 mt-2">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary-container/20 text-on-primary-container font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Submitted
            </span>
            <span className="font-body-sm text-body-sm text-secondary">
              {proposal?.submitted_at ? ABSOLUTE_DATE.format(new Date(proposal.submitted_at)) : ""}
            </span>
            {!locked && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ml-auto font-label-sm text-label-sm text-primary hover:underline"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-4xl">
          <form
            ref={formRef}
            id="proposal-form"
            onSubmit={save}
            className="flex flex-col gap-6"
          >
            <div>
              <label htmlFor="proposal-title" className="block font-label-md text-on-background mb-2">
                Proposal Title
              </label>
              <input
                id="proposal-title"
                name="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={locked}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="proposal-category" className="block font-label-md text-on-background mb-2">
                Research Category
              </label>
              <input
                id="proposal-category"
                name="category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={locked}
                placeholder="e.g. Oncology — Small Molecule"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="proposal-summary" className="block font-label-md text-on-background mb-2">
                Executive Summary
              </label>
              <textarea
                id="proposal-summary"
                name="summary"
                rows={4}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={locked}
                className={`${inputClass} resize-none`}
              />
            </div>

            {error && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                disabled={saving || locked}
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? "Saving…" : "Save"}
              </button>

              {isLead && (
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting || locked}
                  className="px-6 py-3 rounded-lg font-label-md text-label-md border border-primary text-primary hover:bg-primary/5 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
                  {submitting ? "Submitting…" : "Submit proposal"}
                  {!submitting && (
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  )}
                </button>
              )}

              {submitted && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="font-label-sm text-label-sm text-secondary hover:text-primary"
                >
                  Cancel
                </button>
              )}
            </div>

            {!isLead && (
              <p className="font-body-sm text-body-sm text-secondary">
                Only the project lead can submit the proposal — anyone on the team can edit these
                fields first.
              </p>
            )}
          </form>

          <div>
            <label className="block font-label-md text-on-background mb-2">
              Supporting Documents
            </label>
            {proposal?.file_path && (
              <p className="mb-2 font-body-sm text-body-sm text-secondary">
                Current file:{" "}
                {fileUrl ? (
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {fileNameOf(proposal.file_path)}
                  </a>
                ) : (
                  fileNameOf(proposal.file_path)
                )}
                . Uploading a new file replaces it.
              </p>
            )}
            <label
              htmlFor="proposal-file"
              className={
                "border-2 border-dashed border-outline-variant/50 rounded-2xl p-12 flex flex-col items-center justify-center bg-surface-container-lowest text-center h-[220px] " +
                (locked ? "opacity-60" : "hover:bg-surface-container-low/50 transition-colors cursor-pointer group")
              }
            >
              <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-[32px]">cloud_upload</span>
              </div>
              <p className="font-label-md text-on-background mb-1">Click to upload or drag and drop</p>
              <p className="font-body-sm text-secondary">PDF, DOCX, or ZIP (max. 50MB)</p>
              <input
                id="proposal-file"
                name="file"
                type="file"
                // Lives outside the <form> element (it's the grid's right
                // column, the form is the left) — the `form` attribute is
                // what still includes it in that form's FormData on submit.
                form="proposal-form"
                accept=".pdf,.docx,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/x-zip-compressed"
                disabled={locked}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
