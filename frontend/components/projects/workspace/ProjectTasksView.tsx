"use client";

// The Tasks view of a ColaboFest project: up to three lists (Your team, SPARC, Southern
// Research), each with a small header and its own bar ("2 of 5 done"). A row is a round
// status circle (a green ✓ when done), the title, a one-line description, the owner, the
// due date and, for people allowed to change it, "Mark done" / "Undo". The lead and the
// SPARC team (managers) mark team items; managers also add, edit and delete items in
// every list, with an owner and a due date. Members only read. The server re-checks
// every change (lib/server/projectWorkspace/cfChecklist.ts).

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  cfAddItemAction,
  cfDeleteItemAction,
  cfEditItemAction,
  cfSetItemDoneAction,
  setFinalistTaskAction,
  type CfItemInput,
} from "@/app/projects/[id]/actions";
import MoreMenu from "@/components/MoreMenu";
import { dueLabel } from "@/lib/server/projectWorkspace/status";
import { barLine, canEditList, canMarkItem, type CfList, type CfRow, type ListKey } from "@/lib/server/projectWorkspace/cfTasks";

const INPUT =
  "w-full bg-white border border-outline-variant/60 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary";

type Owner = { user_id: string; label: string };

function ItemForm({
  initial,
  owners,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CfItemInput;
  owners: Owner[];
  submitLabel: string;
  onSubmit: (v: CfItemInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onSubmit(v);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#e8e4da] bg-white p-3.5 flex flex-col gap-2.5">
      <input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Task" aria-label="Task" maxLength={300} className={INPUT} autoFocus />
      <div className="grid grid-cols-2 gap-2.5">
        <select value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} aria-label="Owner" className={INPUT}>
          <option value="">No owner</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.label}
            </option>
          ))}
        </select>
        <input type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} aria-label="Due date" className={INPUT} />
      </div>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 rounded-[10px] text-[13px] font-bold leading-5 disabled:opacity-60">
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ProjectTasksView({
  projectId,
  lists,
  role,
  owners,
  ownerIdByName,
  startAdd,
}: {
  projectId: string;
  lists: CfList[];
  role: string;
  owners: Owner[];
  /** The owner's user id by their shown name, for the edit form's first value. */
  ownerIdByName: Record<string, string>;
  /** Open the add form of the first list on arrival (the "+" sheet's Add task). */
  startAdd: boolean;
}) {
  const router = useRouter();
  const canEdit = canEditList(role);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ListKey | null>(startAdd && canEdit ? lists[0]?.key ?? null : null);
  const [editing, setEditing] = useState<string | null>(null);

  const done = (res: { ok: true } | { ok: false; error: string }) => {
    if (res.ok) {
      setAdding(null);
      setEditing(null);
      router.refresh();
    }
    return res;
  };

  const toggle = async (r: CfRow) => {
    if (busy) return;
    setBusy(r.id ?? r.taskKey ?? r.label);
    setError(null);
    const res = r.id ? await cfSetItemDoneAction(projectId, r.id, !r.done) : await setFinalistTaskAction(projectId, r.taskKey ?? "", !r.done);
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  const remove = async (r: CfRow) => {
    if (!r.id || !window.confirm(`Delete "${r.label}"?`)) return;
    setError(null);
    const res = await cfDeleteItemAction(projectId, r.id);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="flex flex-col gap-7">
      {lists.map((l) => {
        const pct = l.total === 0 ? 0 : Math.round((l.done / l.total) * 100);
        return (
          <section key={l.key} aria-label={l.title} className="flex flex-col gap-3">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-title text-[18px] leading-6 text-on-background">{l.title}</h3>
                <span className="text-[12.5px] leading-5 text-secondary">{barLine(l.done, l.total)}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-label={`${l.title} progress`} aria-valuemin={0} aria-valuemax={l.total} aria-valuenow={l.done}>
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {l.rows.length === 0 && adding !== l.key && <p className="font-body-md text-body-md text-secondary">Nothing here yet.</p>}

            <ul className="flex flex-col gap-2">
              {l.rows.map((r) => {
                const key = r.id ?? r.taskKey ?? r.label;
                const mark = canMarkItem(role, l.key);
                if (editing === r.id && r.id) {
                  return (
                    <li key={key}>
                      <ItemForm
                        initial={{ label: r.label, due: r.due ?? "", assigneeId: r.owner ? ownerIdByName[r.owner] ?? "" : "" }}
                        owners={owners}
                        submitLabel="Save"
                        onSubmit={async (v) => done(await cfEditItemAction(projectId, r.id as string, v))}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  );
                }
                return (
                  <li key={key} className="rounded-2xl border border-[#e8e4da] bg-white px-3.5 py-3 flex items-start gap-3">
                    <span
                      className={
                        "grid place-items-center shrink-0 w-7 h-7 mt-0.5 rounded-full border-2 text-[13px] font-extrabold " +
                        (r.done ? "bg-primary border-primary text-on-primary" : "bg-white border-outline-variant text-transparent")
                      }
                      aria-hidden
                    >
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={"font-label-lg text-[14.5px] leading-6 font-bold break-words " + (r.done ? "text-secondary" : "text-on-background")}>{r.label}</p>
                      {r.description && <p className="font-body-md text-[13px] leading-5 text-secondary line-clamp-2">{r.description}</p>}
                      <p className="mt-0.5 text-[12px] leading-5 text-secondary">
                        <span className="sr-only">{r.done ? "Done. " : "To do. "}</span>
                        {r.owner ? `${r.owner} · ` : ""}
                        {r.due ? `Due ${dueLabel(r.due) ?? r.due}` : "No due date"}
                      </p>
                    </div>
                    {mark && (
                      <button
                        type="button"
                        onClick={() => toggle(r)}
                        disabled={busy !== null}
                        className={"shrink-0 rounded-[9px] px-3 py-1.5 text-[12px] font-bold leading-4 disabled:opacity-60 " + (r.done ? "btn-outline" : "btn-primary")}
                      >
                        {busy === key ? "…" : r.done ? "Undo" : "Mark done"}
                      </button>
                    )}
                    {canEdit && r.id && !r.taskKey && (
                      <MoreMenu
                        iconOnly
                        className="shrink-0"
                        items={[
                          { label: "Edit", onClick: () => setEditing(r.id) },
                          { label: "Delete", danger: true, onClick: () => void remove(r) },
                        ]}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            {canEdit &&
              (adding === l.key ? (
                <ItemForm
                  initial={{ label: "", due: "", assigneeId: "" }}
                  owners={owners}
                  submitLabel="Add task"
                  onSubmit={async (v) => done(await cfAddItemAction(projectId, l.key, v))}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setAdding(l.key)}
                    className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
                  >
                    + Add task
                  </button>
                </div>
              ))}
          </section>
        );
      })}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
