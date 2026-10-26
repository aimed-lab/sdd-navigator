"use client";

// Project settings, for site admins only: the "ColaboFest finalist" switch. It
// shows the "★ Finalist" badge next to the project name. The page renders this
// only for a site admin, and the database refuses anybody else.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setFinalistAction } from "@/app/projects/[id]/actions";

export default function FinalistToggle({ projectId, finalist }: { projectId: string; finalist: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(finalist);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async () => {
    if (busy) return;
    const next = !on;
    setBusy(true);
    setError(null);
    const res = await setFinalistAction(projectId, next);
    setBusy(false);
    if (res.ok) {
      setOn(next);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <section className="rounded-xl border border-outline-variant/30 bg-white p-4 flex flex-col gap-2 max-w-md" aria-label="Project settings">
      <h3 className="font-label-lg text-[16px] text-on-background">Project settings (site admin)</h3>
      <label className="flex items-center justify-between gap-4 font-body-md text-body-md text-on-background cursor-pointer">
        <span>ColaboFest finalist</span>
        <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={flip} className="w-5 h-5 accent-primary" />
      </label>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
