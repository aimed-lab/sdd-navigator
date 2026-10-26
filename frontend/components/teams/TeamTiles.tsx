"use client";

// "What do you want to do?": four action cards. Three open a panel right under
// the row (one at a time); "Make learning material" opens the assistant with
// the team attached.

import { useEffect } from "react";
import { openAssistant, setPageTeam } from "@/lib/server/assistant/assistantBridge";
import { makePagePrompt } from "@/lib/server/teams/teamRules";
import ActionTile, { type Tone } from "@/components/ui/ActionTile";
import AddDocumentPanel from "./AddDocumentPanel";
import CuratePagesPanel from "./CuratePagesPanel";
import PanelFrame from "./PanelFrame";
import SharePromotePanel from "./SharePromotePanel";
import { useTeamPanel } from "./TeamPanelContext";

export const TILES: {
  key: "document" | "pages" | "learn" | "share";
  icon: string;
  title: string;
  blurb: string;
  action: string;
  tone: Tone;
}[] = [
  { key: "document", icon: "upload_file", title: "Share a document", blurb: "Upload a file or add a link.", action: "Upload or add a link →", tone: "blue" },
  { key: "pages", icon: "menu_book", title: "Curate wiki pages", blurb: "Add your pages or public ones.", action: "Add pages →", tone: "amber" },
  { key: "learn", icon: "auto_awesome", title: "Make learning material", blurb: "The assistant writes a wiki page for the team.", action: "Ask the AI →", tone: "green" },
  { key: "share", icon: "campaign", title: "Share & promote", blurb: "Post a photo to LinkedIn, X or Facebook, or share team news.", action: "Share →", tone: "purple" },
];

const PANEL_TITLE = {
  document: "Share a document with the team",
  pages: "Add wiki pages to the team",
  share: "Share & promote",
} as const;

export default function TeamTiles({
  teamId,
  slug,
  name,
  description,
  isLead,
  autoOpenLearn = false,
}: {
  teamId: string;
  slug: string;
  name: string;
  description: string | null;
  isLead: boolean;
  /** Arrived after clicking "Make learning material" before joining: open the assistant. */
  autoOpenLearn?: boolean;
}) {
  const { panel, toggle, close } = useTeamPanel();

  // Tell the assistant which team this page is, so a message typed by hand
  // still makes a page for this team and stays on the page.
  useEffect(() => {
    setPageTeam({ id: teamId, name, slug });
    return () => setPageTeam(null);
  }, [teamId, name, slug]);

  useEffect(() => {
    if (!autoOpenLearn) return;
    // The assistant panel mounts a moment after the page; give it time to listen.
    const t = window.setTimeout(
      () => openAssistant({ text: makePagePrompt(name), mode: "fill", team: { id: teamId, name, slug } }),
      700
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenLearn]);

  const pick = (key: (typeof TILES)[number]["key"]) => {
    if (key === "learn") {
      close();
      openAssistant({ text: makePagePrompt(name), mode: "fill", team: { id: teamId, name, slug } });
      return;
    }
    toggle(key);
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="team-do">
      <h2 id="team-do" className="font-headline-sm text-[22px] leading-8 text-on-background scroll-mt-24">
        What do you want to do?
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {TILES.map((t) => (
          // The share tile comes first on a phone (2 columns); on desktop it keeps its place in the row.
          <div key={t.key} className={t.key === "share" ? "flex order-first lg:order-none" : "flex"}>
            <ActionTile
              icon={t.icon}
              title={t.title}
              description={t.blurb}
              action={t.action}
              tone={t.tone}
              featured={t.key === "learn"}
              badge={t.key === "learn" ? "AI" : undefined}
              active={t.key !== "learn" && panel === t.key}
              expanded={t.key === "learn" ? undefined : panel === t.key}
              onClick={() => pick(t.key)}
            />
          </div>
        ))}
      </div>

      {panel === "document" && (
        <PanelFrame title={PANEL_TITLE.document} onClose={close}>
          <AddDocumentPanel teamId={teamId} slug={slug} onClose={close} />
        </PanelFrame>
      )}
      {panel === "pages" && (
        <PanelFrame title={PANEL_TITLE.pages} onClose={close}>
          <CuratePagesPanel teamId={teamId} slug={slug} onClose={close} />
        </PanelFrame>
      )}
      {panel === "share" && (
        <PanelFrame title={PANEL_TITLE.share} onClose={close}>
          <SharePromotePanel teamId={teamId} slug={slug} name={name} description={description} isLead={isLead} onClose={close} />
        </PanelFrame>
      )}
    </section>
  );
}
