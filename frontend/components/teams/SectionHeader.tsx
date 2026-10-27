"use client";

// The top of a section view. On a phone: "← Team home" on the left and one green
// "+ Add ..." on the right, pill buttons to switch section (the active one black),
// then the serif title and a one-line description. On a desktop the tiles above
// are the switch, so it is the title with the Add button on its right, and the
// description. "Invite" (People) is for leads and opens Team settings at the invite
// box. Everything else opens the same dialog the old tile did.

import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { TEAM_VIEWS, VIEW_META, viewHref, type TeamView } from "@/lib/server/teams/teamUi";
import { useTeamPanel, type TeamPanel } from "./TeamPanelContext";

const ADD_PANEL: Record<Exclude<TeamView, "people">, Exclude<TeamPanel, null>> = {
  slides: "document",
  learn: "pages",
  photos: "photo",
};

/** Opens Team settings and scrolls to its invite-by-email part. */
function openInvite() {
  const settings = document.getElementById("settings") as HTMLDetailsElement | null;
  if (settings) settings.open = true;
  document.getElementById("team-invite")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export default function SectionHeader({ slug, view, isLead }: { slug: string; view: TeamView; isLead: boolean }) {
  const { open } = useTeamPanel();
  const meta = VIEW_META[view];

  const addLabel = view === "people" ? (isLead ? "Invite" : null) : meta.add;
  const onAdd = () => (view === "people" ? openInvite() : open(ADD_PANEL[view]));
  const addButton = addLabel ? (
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1 rounded-[10px] bg-[#0f6b33] px-[13px] py-2 text-[13px] font-bold leading-5 text-white hover:bg-[#0b3d22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33] focus-visible:ring-offset-2"
    >
      {view !== "people" && <Plus size={18} strokeWidth={1.75} aria-hidden />}
      {addLabel}
    </button>
  ) : null;

  return (
    <div className="flex flex-col">
      {/* phone */}
      <div className="md:hidden flex flex-col">
        <div className="flex items-center justify-between mt-3.5 mb-2.5 min-h-9">
          <Link href={viewHref(slug, null)} scroll={false} className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-[#0f6b33]">
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
            Team home
          </Link>
          {addButton}
        </div>
        <SwitchPills slug={slug} view={view} />
      </div>

      {/* desktop */}
      <div className="hidden md:flex flex-col mt-5">
        <Link href={viewHref(slug, null)} scroll={false} className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-[#0f6b33] mb-1">
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Team home
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-title text-[24px] leading-8 text-[#1d1d1b]">{meta.title}</h2>
          {addButton}
        </div>
      </div>

      <h2 className="md:hidden font-title text-[20px] leading-7 text-[#1d1d1b] mb-0.5">{meta.title}</h2>
      <p className="text-[12.5px] leading-[18px] text-[#6b6a64] mb-3 md:mt-1">{meta.description}</p>
    </div>
  );
}

/** Pill buttons that switch section; the active one is black. */
export function SwitchPills({ slug, view }: { slug: string; view: TeamView }) {
  return (
    <nav aria-label="Switch section" className="flex gap-1.5 overflow-x-auto mb-3 -mx-0.5 px-0.5">
      {TEAM_VIEWS.map((v) => {
        const on = v === view;
        return (
          <Link
            key={v}
            href={viewHref(slug, v)}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={
              "whitespace-nowrap rounded-full border px-3 py-2 text-[12.5px] font-semibold leading-4 " +
              (on ? "bg-[#1d1d1b] border-[#1d1d1b] text-white" : "bg-white border-[#e8e4da] text-[#6b6a64] hover:text-[#1d1d1b]")
            }
          >
            {VIEW_META[v].label}
          </Link>
        );
      })}
    </nav>
  );
}
