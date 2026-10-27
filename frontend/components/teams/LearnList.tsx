"use client";

// Learn: the team's wiki pages as a list. The "Start here" page comes first and is
// fully green (a star); the others are numbered in a green square with
// "N new papers" (new research this week) or "Updated <date>" underneath. A row
// opens the page. The ⋯ menu keeps Remove for the people who may take a page off
// the team (a page is never deleted by it).

import Link from "next/link";
import { BookOpen, ChevronRight, Plus, Sparkles, Star } from "lucide-react";
import { removeTeamPageAction } from "@/app/teams/actions";
import MoreMenu, { type MoreMenuItem } from "@/components/MoreMenu";
import { openAssistant } from "@/lib/server/assistant/assistantBridge";
import { shortDate } from "@/lib/server/communityHome/communityHome";
import { makePagePrompt, teamPageHref } from "@/lib/server/teams/teamRules";
import { isStartHere, learnLine, startHereFirst } from "@/lib/server/teams/teamUi";
import type { TeamPage } from "@/lib/server/teams/teams";
import { Empty, Err, useDo } from "./TeamShelves";
import { useTeamPanel } from "./TeamPanelContext";

export default function LearnList({
  teamId,
  teamName,
  slug,
  pages,
  newCounts,
  isLead,
}: {
  teamId: string;
  teamName: string;
  slug: string;
  /** Newest first. */
  pages: TeamPage[];
  /** New items per page in the last 7 days. */
  newCounts: Record<string, number>;
  /** Learning pages are curated by leads: members see the list and open pages, nothing else. */
  isLead: boolean;
}) {
  const { busy, error, run } = useDo();
  const panel = useTeamPanel();

  if (pages.length === 0) {
    return (
      <>
        <Empty
          icon={<BookOpen size={22} strokeWidth={1.75} aria-hidden />}
          text={isLead ? "No learning pages yet. Ask the AI to write one, or add a page you already have." : "No learning pages yet. Your team leads add them here."}
        >
          {isLead && (
          <button
            type="button"
            onClick={() => openAssistant({ text: makePagePrompt(teamName), mode: "fill", team: { id: teamId, name: teamName, slug } })}
            className="inline-flex items-center gap-1 rounded-[10px] border border-[#e8e4da] bg-white px-[13px] py-2 text-[13px] font-bold leading-5 text-[#1d1d1b] hover:border-[#0f6b33]"
          >
            <Sparkles size={18} strokeWidth={1.75} aria-hidden />
            Ask the AI
          </button>
          )}
          {isLead && (
          <button
            type="button"
            onClick={() => panel.open("pages")}
            className="inline-flex items-center gap-1 rounded-[10px] bg-[#0f6b33] px-[13px] py-2 text-[13px] font-bold leading-5 text-white hover:bg-[#0b3d22]"
          >
            <Plus size={18} strokeWidth={1.75} aria-hidden />
            Add a page
          </button>
          )}
        </Empty>
        <Err text={error} />
      </>
    );
  }

  const ordered = startHereFirst(pages);
  let n = 0;

  return (
    <>
      <ul className="flex flex-col gap-[9px]">
        {ordered.map((p) => {
          const start = isStartHere(p.title);
          if (!start) n += 1;
          const line = learnLine(newCounts[p.pageId] ?? 0, p.lastRefreshedAt ? shortDate(p.lastRefreshedAt) : "");
          const fresh = (newCounts[p.pageId] ?? 0) > 0;
          const items: MoreMenuItem[] = isLead && p.canRemove
            ? [
                {
                  label: "Remove from team",
                  danger: true,
                  onClick: () => {
                    if (window.confirm(`Take "${p.title}" off the team? The page itself is not deleted.`)) {
                      void run(p.pageId, () => removeTeamPageAction(teamId, slug, p.pageId));
                    }
                  },
                },
              ]
            : [];
          return (
            <li
              key={p.pageId}
              data-item-id={p.pageId}
              className={
                "flex items-center gap-3 rounded-[14px] border p-[13px] min-w-0 " +
                (start ? "bg-[#0f6b33] border-[#0f6b33] text-white" : "bg-white border-[#e8e4da] text-[#1d1d1b]") +
                (busy === p.pageId ? " opacity-50" : "")
              }
            >
              <span
                className="grid place-items-center shrink-0 w-9 h-9 rounded-[10px] font-extrabold text-[15px]"
                style={start ? { background: "rgba(255,255,255,0.18)" } : { background: "#e9f5ec", color: "#0f6b33" }}
                aria-hidden
              >
                {start ? <Star size={18} strokeWidth={1.75} /> : n}
              </span>
              <Link href={teamPageHref(p.slug, slug)} className="min-w-0 flex-1 focus-visible:outline-none focus-visible:underline">
                <b className="block text-[14px] leading-5 font-bold break-words">{p.title}</b>
                {line && (
                  <small
                    className={"block text-[11.5px] leading-4 " + (start ? "text-[#d4ecdc]" : fresh ? "text-[#0f6b33] font-bold" : "text-[#6b6a64]")}
                  >
                    {line}
                  </small>
                )}
              </Link>
              {items.length > 0 && <MoreMenu items={items} iconOnly className="shrink-0" />}
              <ChevronRight size={18} strokeWidth={1.75} className={start ? "text-white" : "text-[#6b6a64]"} aria-hidden />
            </li>
          );
        })}
      </ul>
      <Err text={error} />
    </>
  );
}
