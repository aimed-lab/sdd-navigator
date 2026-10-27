"use client";

// The six tiles under the hero: Slides, Learn, Photos, People, Ask AI, Share. Three
// across on a phone, six in one row on a desktop. The first four are links that
// switch the page to that section (?view=...); the selected one gets a green
// border and soft green background. Ask AI opens the assistant with the team
// attached; Share opens the existing Share & promote flow in a dialog. On a phone,
// inside a section, the tiles are hidden (the section has its own switch pills).
// This file also holds the add dialogs, which the "+ Add ..." buttons open.

import { useEffect } from "react";
import Link from "next/link";
import { openAssistant, setPageTeam } from "@/lib/server/assistant/assistantBridge";
import { ASSISTANT_ENABLED } from "@/lib/siteMode";
import { makePagePrompt } from "@/lib/server/teams/teamRules";
import { tileCount, viewHref, type TeamView } from "@/lib/server/teams/teamUi";
import Sheet from "@/components/ui/Sheet";
import AddDocumentPanel from "./AddDocumentPanel";
import CuratePagesPanel from "./CuratePagesPanel";
import SharePromotePanel from "./SharePromotePanel";
import { SECTION_ICON, SoftIcon, type SectionKey } from "./TeamIcons";
import { useTeamPanel } from "./TeamPanelContext";

type Counts = { slides: number; learn: number; photos: number; people: number };

const TILE =
  "group relative text-center min-w-0 flex flex-col items-center basis-[calc((100%-20px)/3)] md:basis-[calc((100%-40px)/5)] grow-0 shrink-0 rounded-2xl border border-[#e8e4da] bg-white px-1.5 pt-4 pb-3.5 md:pt-[18px] md:pb-3.5 " +
  "transition-colors hover:border-[#0f6b33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33] focus-visible:ring-offset-2";

function TileBody({ k, name, small, on, pill }: { k: SectionKey; name: string; small: string; on: boolean; pill?: string }) {
  return (
    <>
      {pill && (
        <span className="absolute top-2.5 right-2.5 rounded-full bg-[#0f6b33] px-1.5 py-0.5 text-[10px] font-bold leading-[14px] text-white">
          {pill}
        </span>
      )}
      <SoftIcon icon={SECTION_ICON[k]} on={on} className="mb-[9px]" />
      <span className="block text-[14px] leading-[18px] font-bold text-[#1d1d1b]">{name}</span>
      <span className="block mt-0.5 text-[11.5px] leading-4 text-[#6b6a64]">{small}</span>
    </>
  );
}

export default function TeamTiles({
  teamId,
  slug,
  name,
  description,
  isLead,
  view,
  counts,
  newLearn,
  autoOpenLearn = false,
}: {
  teamId: string;
  slug: string;
  name: string;
  description: string | null;
  isLead: boolean;
  /** The section being shown, or null on the team home. */
  view: TeamView | null;
  counts: Counts;
  /** Pages that collected new research in the last 7 days. */
  newLearn: number;
  /** Arrived after clicking "Make learning material" before joining: open the assistant. */
  autoOpenLearn?: boolean;
}) {
  const { panel, open, close } = useTeamPanel();

  // Tell the assistant which team this page is, so a message typed by hand
  // still makes a page for this team and stays on the page.
  useEffect(() => {
    // canCurate: only a lead can have the assistant make or add a wiki page for the team.
    if (!ASSISTANT_ENABLED) return;
    setPageTeam({ id: teamId, name, slug, canCurate: isLead });
    return () => setPageTeam(null);
  }, [teamId, name, slug, isLead]);

  // A lead: "make a page" (the assistant drafts a wiki page for the team). A member:
  // the assistant opens as a question box about the team's material; the team page
  // already told it which team this is, and it never offers to make or add a page.
  const ask = () =>
    isLead
      ? openAssistant({ text: makePagePrompt(name), mode: "fill", team: { id: teamId, name, slug, canCurate: true } })
      : openAssistant({ text: "", mode: "open" });

  useEffect(() => {
    if (!autoOpenLearn || !ASSISTANT_ENABLED) return;
    // The assistant panel mounts a moment after the page; give it time to listen.
    const t = window.setTimeout(ask, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenLearn]);

  const sections: { k: "slides" | "learn" | "photos" | "people"; name: string; small: string; pill?: string }[] = [
    { k: "slides", name: "Slides", small: tileCount("slides", counts.slides) },
    { k: "learn", name: "Learn", small: tileCount("learn", counts.learn), pill: newLearn > 0 ? `${newLearn} new` : undefined },
    { k: "photos", name: "Photos", small: tileCount("photos", counts.photos) },
    { k: "people", name: "People", small: tileCount("people", counts.people) },
  ];

  return (
    <>
      {/* Five tiles: one row on a desktop; on a phone 3, then the rest centred. */}
      <nav aria-label="Team sections" className={`${view ? "hidden md:flex" : "flex"} flex-wrap justify-center gap-2.5`}>
        {sections.map((t) => {
          const on = view === t.k;
          return (
            <Link
              key={t.k}
              // Tapping the selected tile again goes back to the team home.
              href={viewHref(slug, on ? null : t.k)}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={TILE}
              style={on ? { borderColor: "#0f6b33", borderWidth: 2, background: "#e9f5ec" } : undefined}
            >
              <TileBody k={t.k} name={t.name} small={t.small} pill={t.pill} on={on} />
            </Link>
          );
        })}
        {ASSISTANT_ENABLED && (
          <button type="button" onClick={ask} className={TILE}>
            <TileBody k="ask" name="Ask AI" small={isLead ? "make a page" : "ask about the talk"} on={false} />
          </button>
        )}
        <button type="button" onClick={() => open("share")} aria-haspopup="dialog" className={TILE}>
          <TileBody k="share" name="Share" small="post a photo" on={false} />
        </button>
      </nav>

      {panel === "document" && (
        <Sheet title="Add a file" onClose={close}>
          <AddDocumentPanel teamId={teamId} slug={slug} onClose={close} />
        </Sheet>
      )}
      {panel === "photo" && (
        <Sheet title="Add a photo" onClose={close}>
          <AddDocumentPanel teamId={teamId} slug={slug} onClose={close} mode="photo" />
        </Sheet>
      )}
      {panel === "pages" && isLead && (
        <Sheet title="Add a page" onClose={close}>
          <CuratePagesPanel teamId={teamId} slug={slug} onClose={close} />
        </Sheet>
      )}
      {panel === "share" && (
        <Sheet title="Share & promote" onClose={close}>
          <SharePromotePanel teamId={teamId} slug={slug} name={name} description={description} isLead={isLead} onClose={close} />
        </Sheet>
      )}
    </>
  );
}
