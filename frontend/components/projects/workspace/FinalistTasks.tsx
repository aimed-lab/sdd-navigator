"use client";

// The Tasks view of a ColaboFest finalist: three numbered cards. Each shows the title,
// a short description, the due date and a status (To do / Done). The project lead and
// the SPARC team also get "Mark done" / "Mark not done". The status is stored in the
// project's checklist items (see lib/server/projectWorkspace/finalistTasksDb.ts).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setFinalistTaskAction } from "@/app/projects/[id]/actions";
import { FINALIST_DUE, FINALIST_FILES_NOTE } from "@/lib/colabofestConfig";
import type { TaskRow } from "@/lib/server/projectWorkspace/finalistTasks";

export default function FinalistTasks({ projectId, rows, canMark }: { projectId: string; rows: TaskRow[]; canMark: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mark = async (r: TaskRow) => {
    if (busy) return;
    setBusy(r.key);
    setError(null);
    const res = await setFinalistTaskAction(projectId, r.key, !r.done);
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.key} className="rounded-2xl border border-[#e8e4da] bg-white p-4 flex gap-3.5">
            <span
              className={
                "grid place-items-center shrink-0 w-9 h-9 rounded-[10px] font-extrabold text-[15px] " +
                (r.done ? "bg-primary text-on-primary" : "bg-surface-container-low text-primary")
              }
              aria-hidden
            >
              {r.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-label-lg text-[15px] leading-6 font-bold text-on-background break-words">{r.label}</h3>
              <p className="font-body-md text-[13.5px] leading-5 text-secondary mt-0.5 line-clamp-2">{r.description}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  className={
                    "rounded-full px-2.5 py-0.5 text-[11.5px] font-bold leading-4 " +
                    (r.done ? "bg-primary text-on-primary" : "bg-surface-container-low text-secondary")
                  }
                >
                  {r.done ? "Done" : "To do"}
                </span>
                <span className="text-[12.5px] leading-5 text-secondary">Due {FINALIST_DUE.long}</span>
                {canMark && (
                  <button
                    type="button"
                    onClick={() => mark(r)}
                    disabled={busy !== null}
                    className={
                      "ml-auto rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold leading-4 disabled:opacity-60 " +
                      (r.done ? "btn-outline" : "btn-primary")
                    }
                  >
                    {busy === r.key ? "Saving…" : r.done ? "Mark not done" : "Mark done"}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <p className="font-body-md text-body-md text-secondary">{FINALIST_FILES_NOTE}</p>
    </div>
  );
}
