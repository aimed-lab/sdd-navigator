"use client";

// The Team view of a ColaboFest project: a clean list (avatar, name, role: Lead / Member /
// SPARC team, and the SPARC or Southern Research affiliation when set). Managers (the
// SPARC team) also get "Add a member by email" and "Remove" for ordinary members, the same
// flow and rules as the old Team section (lib/server/projects.ts addProjectMember /
// removeProjectMember). Everyone else only reads.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMemberAction, removeMemberAction } from "@/app/projects/[id]/actions";
import { initials } from "@/lib/server/communityHome/communityHome";
import { AFFILIATION_LABEL } from "@/lib/server/projectWorkspace/colabofest";
import type { ProjectMember } from "@/lib/server/projects";

const ROLE: Record<string, string> = { lead: "Lead", manager: "SPARC team", member: "Member" };

export default function ProjectTeamView({
  projectId,
  members,
  isManager,
  startAdd,
}: {
  projectId: string;
  members: ProjectMember[];
  isManager: boolean;
  /** Focus the add box on arrival (the "+" sheet's Add member). */
  startAdd: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy("add");
    setError(null);
    setNote(null);
    const res = await addMemberAction(projectId, email, "member");
    setBusy(null);
    if (res.ok) {
      setNote(`Added ${email.trim()}.`);
      setEmail("");
      router.refresh();
    } else setError(res.error);
  };

  const remove = async (m: ProjectMember) => {
    if (busy || !window.confirm(`Remove ${m.name || m.email} from the project?`)) return;
    setBusy(m.id);
    setError(null);
    const res = await removeMemberAction(projectId, m.id);
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const pending = !m.user_id;
          const shown = m.user_id && m.name ? m.name : m.email;
          return (
            <li key={m.id} className="rounded-2xl border border-[#e8e4da] bg-white px-3.5 py-2.5 flex items-center gap-3 min-w-0">
              <span className="grid place-items-center shrink-0 w-[34px] h-[34px] rounded-full bg-surface-container-low text-primary text-[12px] font-bold" aria-hidden>
                {initials(shown)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-5 font-semibold text-on-background truncate">{shown}</p>
                <p className="text-[12px] leading-4 text-secondary">
                  {ROLE[m.role] ?? "Member"}
                  {m.affiliation ? ` · ${AFFILIATION_LABEL[m.affiliation]}` : ""}
                  {pending ? " · invited" : ""}
                </p>
              </div>
              {isManager && m.role === "member" && (
                <button
                  type="button"
                  onClick={() => remove(m)}
                  disabled={busy !== null}
                  className="shrink-0 text-[12.5px] font-semibold text-secondary hover:text-error disabled:opacity-50"
                >
                  {busy === m.id ? "…" : "Remove"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {isManager && (
        <form onSubmit={add} className="rounded-2xl border border-[#e8e4da] bg-white p-3.5 flex flex-col gap-2.5">
          <label htmlFor="add-member-email" className="font-label-md text-label-md text-on-background">
            Add a member by email
          </label>
          <div className="flex gap-2">
            <input
              id="add-member-email"
              type="email"
              required
              autoFocus={startAdd}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.org"
              className="flex-1 min-w-0 bg-white border border-outline-variant/60 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button type="submit" disabled={busy !== null} className="btn-primary px-4 rounded-[10px] text-[13px] font-bold leading-5 shrink-0 disabled:opacity-60">
              {busy === "add" ? "Adding…" : "Add"}
            </button>
          </div>
          <p className="font-body-sm text-body-sm text-secondary">They can open the project once they sign in with this email.</p>
          {note && <p className="font-body-sm text-body-sm text-primary">{note}</p>}
        </form>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
