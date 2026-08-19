"use client";

// Team section — frontend/design/projects/STRUCTURE.md, detail workspace,
// "Team". Add/remove/promote are lead-only (ANY lead — co-leads have equal
// standing here, see database/migrations/2026-08-08_project_co_leads.sql);
// the UI hiding those controls is a convenience, not the gate —
// lib/server/projects.ts re-checks server-side on every call, and RLS backs
// that up in Postgres regardless of what this component renders.
//
// CONTROLS PER ROW (viewer must be a lead to see any of this at all):
//   - a MEMBER row (linked)  -> "Make lead" and "Remove"
//   - a PENDING row          -> "Remove" only (can't promote someone who
//                                hasn't accepted their invite yet)
//   - the VIEWER'S OWN row, if they're a lead -> "Step down" (self only)
//   - any OTHER lead's row   -> no controls at all — no one may remove or
//                                demote a lead but themselves
// A plain (non-lead) member sees names and the Lead pill only, no controls
// anywhere, including their own row.
//
// DISPLAY NAME: resolved server-side via project_member_names()
// (database/migrations/2026-08-07_project_member_names.sql), NOT a plain
// join on public.users — that table's own SELECT policy blanks out a
// private-profile member instead of falling back to email. Three cases per
// row, matching that function's own privacy rule:
//   - no user_id yet (pending invite)         -> email + "Pending" pill
//   - linked, name resolved                   -> name, linked to their
//                                                 profile when profile_slug
//                                                 is set (same as PostCard),
//                                                 email shown as a second,
//                                                 muted line
//   - linked, no name resolved (shouldn't
//     really happen, but defensive)           -> email only

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addMemberAction,
  promoteMemberAction,
  removeMemberAction,
  stepDownAction,
} from "@/app/projects/[id]/actions";
import type { ProjectMember } from "@/lib/server/projects";

function MemberAvatar({ pending }: { pending: boolean }) {
  return (
    <div
      className={
        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 " +
        (pending
          ? "bg-surface-container border border-outline-variant/30 border-dashed text-secondary"
          : "bg-primary/10 text-primary")
      }
    >
      <span className="material-symbols-outlined text-[20px]">person</span>
    </div>
  );
}

function RemoveMemberConfirm({
  email,
  onCancel,
  onConfirm,
  removing,
  error,
}: {
  email: string;
  onCancel: () => void;
  onConfirm: () => void;
  removing: boolean;
  error: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Remove ${email}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">warning</span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Remove this member?
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              {email} will lose access to this project. This can&apos;t be undone.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={removing}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={removing}
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {removing ? "Removing…" : "Remove member"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeamSection({
  projectId,
  members,
  isLead,
  viewerUserId,
}: {
  projectId: string;
  members: ProjectMember[];
  isLead: boolean;
  /** The signed-in viewer's own user id — needed to tell "the viewer's own
   *  row" apart from any other lead's row (only the former gets a "Step
   *  down" control; the latter gets no control at all). */
  viewerUserId: string;
}) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [confirmTarget, setConfirmTarget] = useState<ProjectMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const [steppingDown, setSteppingDown] = useState(false);
  const [stepDownError, setStepDownError] = useState<string | null>(null);

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adding || !email.trim()) return;
    setAdding(true);
    setAddError(null);

    const res = await addMemberAction(projectId, email);
    if (res.ok) {
      setEmail("");
      router.refresh();
    } else {
      setAddError(res.error);
    }
    setAdding(false);
  };

  const confirmRemove = async () => {
    if (!confirmTarget || removing) return;
    setRemoving(true);
    setRemoveError(null);

    const res = await removeMemberAction(projectId, confirmTarget.id);
    if (res.ok) {
      setConfirmTarget(null);
      router.refresh();
    } else {
      setRemoveError(res.error);
    }
    setRemoving(false);
  };

  const promote = async (memberId: string) => {
    if (promotingId) return;
    setPromotingId(memberId);
    setPromoteError(null);

    const res = await promoteMemberAction(projectId, memberId);
    if (res.ok) {
      router.refresh();
    } else {
      setPromoteError(res.error);
    }
    setPromotingId(null);
  };

  const stepDown = async () => {
    if (steppingDown) return;
    setSteppingDown(true);
    setStepDownError(null);

    const res = await stepDownAction(projectId);
    if (res.ok) {
      router.refresh();
    } else {
      // Most commonly "A project must always have at least one lead." —
      // the app-layer pre-check's message; the trigger's own rejection (if
      // it ever races ahead of that check) reads the same way.
      setStepDownError(res.error);
    }
    setSteppingDown(false);
  };

  return (
    <section className="mb-20">
      <h2 className="font-headline-md text-headline-md text-on-background mb-8">Team</h2>

      <div className="flex flex-col gap-2 max-w-3xl">
        {members.map((m) => {
          const pending = !m.user_id;
          // Primary line: name when resolved, email otherwise (pending, or
          // the defensive "linked but no name came back" case).
          const primary = !pending && m.name ? m.name : m.email;
          // Secondary muted line: only when the primary line is a NAME —
          // showing the email again under itself (pending) or repeating it
          // with nothing new to add (no name resolved) would be noise.
          const showEmailBelow = !pending && !!m.name;

          return (
            <div
              key={m.id}
              className="flex items-center justify-between p-4 rounded-xl border border-transparent hover:border-outline-variant/30 hover:bg-surface-container-lowest transition-colors group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <MemberAvatar pending={pending} />
                <div className="min-w-0">
                  <div className="font-label-md text-label-md text-on-background flex items-center gap-3 truncate">
                    {!pending && m.name && m.profile_slug ? (
                      <Link
                        href={`/researchers/${m.profile_slug}`}
                        className="truncate hover:text-primary hover:underline underline-offset-4"
                      >
                        {primary}
                      </Link>
                    ) : (
                      <span className="truncate">{primary}</span>
                    )}
                    {m.role === "lead" && (
                      <span className="shrink-0 bg-primary/10 text-primary px-2 py-0.5 rounded-full font-label-sm text-[10px] uppercase tracking-wider">
                        Lead
                      </span>
                    )}
                    {pending && m.role !== "lead" && (
                      <span className="shrink-0 bg-surface-dim text-secondary px-2 py-0.5 rounded-full font-label-sm text-[10px] uppercase tracking-wider">
                        Pending
                      </span>
                    )}
                  </div>
                  {showEmailBelow && (
                    <div className="font-body-sm text-body-sm text-secondary truncate">
                      {m.email}
                    </div>
                  )}
                  {pending && (
                    <div className="font-body-sm text-body-sm text-secondary">
                      {/* Honest, not "Awaiting invitation acceptance" — no
                          invitation is sent and there's nothing to accept.
                          This is added-by-email, unlinked to an account
                          until someone signs in with that exact address
                          (addProjectMember's DB-side lookup links it
                          immediately if the account already exists;
                          claim_pending_project_memberships() links it on
                          sign-in/next projects-list load otherwise — see
                          lib/server/projects.ts). */}
                      Hasn&apos;t signed in yet — they&apos;ll be linked once they sign in with
                      this exact email.
                    </div>
                  )}
                </div>
              </div>

              {isLead && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-4 shrink-0">
                  {m.role === "member" && (
                    <>
                      {!pending && (
                        <button
                          type="button"
                          onClick={() => promote(m.id)}
                          disabled={promotingId === m.id}
                          className="font-label-sm text-label-sm text-primary hover:underline disabled:opacity-50"
                        >
                          {promotingId === m.id ? "Making lead…" : "Make lead"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveError(null);
                          setConfirmTarget(m);
                        }}
                        className="font-label-sm text-label-sm text-secondary hover:text-error"
                      >
                        Remove
                      </button>
                    </>
                  )}
                  {m.role === "lead" && m.user_id === viewerUserId && (
                    <button
                      type="button"
                      onClick={stepDown}
                      disabled={steppingDown}
                      className="font-label-sm text-label-sm text-secondary hover:text-error disabled:opacity-50"
                    >
                      {steppingDown ? "Stepping down…" : "Step down"}
                    </button>
                  )}
                  {/* Another lead's row (m.role === "lead" && m.user_id !==
                      viewerUserId): no control at all, on purpose — no one
                      may remove or demote a lead but themselves. */}
                </div>
              )}
            </div>
          );
        })}

        {isLead && promoteError && (
          <p className="font-body-sm text-body-sm text-error mt-1" role="alert">
            {promoteError}
          </p>
        )}
        {isLead && stepDownError && (
          <p className="font-body-sm text-body-sm text-error mt-1" role="alert">
            {stepDownError}
          </p>
        )}

        {isLead && (
          <form
            onSubmit={submitAdd}
            className="mt-4 p-4 flex items-center gap-4 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-sm"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email address to invite..."
              aria-label="Email address to invite"
              className="flex-1 bg-transparent border-none focus:ring-0 p-0 font-body-md text-body-md text-on-background placeholder:text-secondary/60 outline-none min-w-0"
            />
            <button
              type="submit"
              disabled={adding}
              className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md flex items-center gap-2 shrink-0 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {adding ? "Adding…" : "Add member"}
            </button>
          </form>
        )}
        {isLead && addError && (
          <p className="font-body-sm text-body-sm text-error mt-1" role="alert">
            {addError}
          </p>
        )}
      </div>

      {confirmTarget && (
        <RemoveMemberConfirm
          email={confirmTarget.email}
          removing={removing}
          error={removeError}
          onCancel={() => {
            setConfirmTarget(null);
            setRemoveError(null);
          }}
          onConfirm={confirmRemove}
        />
      )}
    </section>
  );
}
