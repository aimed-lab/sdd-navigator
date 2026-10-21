"use client";

// The welcome checklist on Home, for members in their first 14 days. "N of 5
// done", dismissible. What counts as done is decided on the server
// (lib/server/communityHome/checklist.ts); this only draws it.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dismissChecklistAction } from "@/app/communities/actions";
import type { ChecklistItem } from "@/lib/server/communityHome/checklist";

export default function WelcomeChecklist({
  communityId,
  slug,
  items,
  done,
  total,
}: {
  communityId: string;
  slug: string;
  items: ChecklistItem[];
  done: number;
  total: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <section aria-label="Welcome checklist" className="rounded-2xl glass-panel p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-headline-sm text-headline-sm text-on-background">Welcome</h2>
        <div className="flex items-center gap-3">
          <span className="font-label-md text-label-md text-primary">
            {done} of {total} done
          </span>
          <button
            type="button"
            disabled={busy}
            aria-label="Dismiss the welcome checklist"
            onClick={async () => {
              setBusy(true);
              const res = await dismissChecklistAction(communityId, slug);
              if (res.ok) router.refresh();
              else setBusy(false);
            }}
            className="text-secondary hover:text-on-background transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-surface-container-low overflow-hidden" aria-hidden>
        <div className="h-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
      </div>

      <ul className="flex flex-col divide-y divide-outline-variant/30">
        {items.map((item) => {
          const body = (
            <>
              <span
                className={`material-symbols-outlined text-[22px] shrink-0 ${item.done ? "text-primary" : "text-secondary/50"}`}
                aria-hidden
              >
                {item.done ? "check_circle" : "radio_button_unchecked"}
              </span>
              <span className="min-w-0">
                <span
                  className={`block font-label-lg text-label-lg ${item.done ? "text-secondary line-through" : "text-on-background"}`}
                >
                  {item.label}
                  <span className="sr-only">{item.done ? " (done)" : " (not done yet)"}</span>
                </span>
                {!item.done && <span className="block font-body-sm text-body-sm text-secondary">{item.hint}</span>}
              </span>
            </>
          );
          const cls = "flex items-start gap-3 py-2.5";
          return (
            <li key={item.key}>
              {item.href && !item.done ? (
                item.href.startsWith("#") ? (
                  <a href={item.href} className={`${cls} hover:bg-surface-container-low/60 rounded-lg`}>
                    {body}
                  </a>
                ) : (
                  <Link href={item.href} className={`${cls} hover:bg-surface-container-low/60 rounded-lg`}>
                    {body}
                  </Link>
                )
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
