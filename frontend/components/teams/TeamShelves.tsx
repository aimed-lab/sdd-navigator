"use client";

// Small shared pieces of the team page's sections (the empty box, the error line,
// the "run a server action then refresh" helper) and the Team news card.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAnnouncementAction } from "@/app/communities/actions";
import MoreMenu from "@/components/MoreMenu";
import { shortDate } from "@/lib/server/communityHome/communityHome";
import type { Announcement } from "@/lib/server/communities";

/** A dashed box that says what to do, with at most one button. */
export function Empty({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-[1.5px] border-dashed border-[#cfc8b8] bg-white px-4 py-7 flex flex-col items-center gap-3 text-center">
      <span className="text-[#0f6b33]" aria-hidden>
        {icon}
      </span>
      <p className="text-[14px] leading-[1.5] text-[#6b6a64]">{text}</p>
      {children && <div className="flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function useDo() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Something went wrong.");
  };
  return { busy, error, run };
}

export function Err({ text }: { text: string | null }) {
  return text ? (
    <p className="text-[13px] leading-5 text-error mt-2" role="alert">
      {text}
    </p>
  ) : null;
}

/** Team news posted by the leads (through Share & promote). Shown on the team home. */
export function NewsList({ teamId, slug, items, isLead }: { teamId: string; slug: string; items: Announcement[]; isLead: boolean }) {
  const { busy, error, run } = useDo();
  if (items.length === 0) return null;
  return (
    <section data-item-id="team-news" className="rounded-2xl border border-[#e8e4da] bg-white p-3.5 min-w-0">
      <h3 className="font-title text-[16px] leading-6 text-[#1d1d1b] mb-2">Team news</h3>
      <ul>
        {items.slice(0, 5).map((a) => (
          <li
            key={a.id}
            className={`flex items-start gap-3 py-2 border-t border-[#e8e4da] first:border-t-0 ${busy === a.id ? "opacity-50" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-[18px] font-bold text-[#1d1d1b] break-words">{a.title}</p>
              {a.body && <p className="text-[13px] leading-[1.5] text-[#6b6a64] whitespace-pre-line break-words">{a.body}</p>}
              <p className="mt-0.5 text-[11.5px] leading-4 text-[#6b6a64]">{shortDate(a.created_at)}</p>
            </div>
            {isLead && (
              <MoreMenu
                iconOnly
                className="shrink-0"
                items={[
                  {
                    label: "Delete",
                    danger: true,
                    onClick: () => {
                      if (window.confirm("Delete this news item?")) void run(a.id, () => deleteAnnouncementAction(teamId, a.id, slug));
                    },
                  },
                ]}
              />
            )}
          </li>
        ))}
      </ul>
      <Err text={error} />
    </section>
  );
}
