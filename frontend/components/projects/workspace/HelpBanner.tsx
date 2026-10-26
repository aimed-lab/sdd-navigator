"use client";

// "Needs help: <first line>" on a project's Overview while a help post is
// unresolved. A lead or manager can mark it resolved right here; everyone else
// is pointed at the Announcements tab.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolveHelpAction } from "@/app/projects/[id]/actions";
import { canResolve, firstLine } from "@/lib/server/projectWorkspace/status";
import { tabHref } from "@/lib/server/projectWorkspace/workspace";

export default function HelpBanner({
  projectId,
  role,
  posts,
}: {
  projectId: string;
  role: string;
  posts: { id: string; body: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (posts.length === 0) return null;

  const resolve = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const res = await resolveHelpAction(projectId, id, true);
    setBusyId(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="flex flex-col gap-2" role="region" aria-label="Help requests">
      {posts.slice(0, 3).map((p) => (
        <div
          key={p.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-error/10 border border-error/30 px-4 py-3"
        >
          <p className="font-body-md text-body-md text-on-background min-w-0 break-words">
            <span className="font-semibold text-error">Needs help:</span> {firstLine(p.body)}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <Link href={tabHref(projectId, "announcements")} className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4">
              Open
            </Link>
            {canResolve(role) && (
              <button
                type="button"
                disabled={busyId === p.id}
                onClick={() => resolve(p.id)}
                className="btn-outline px-3 py-1 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
              >
                Mark as resolved
              </button>
            )}
          </div>
        </div>
      ))}
      {posts.length > 3 && (
        <p className="font-body-sm text-body-sm text-secondary">and {posts.length - 3} more on the Announcements tab</p>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
