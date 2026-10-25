"use client";

// "What do you want to do?", four tiles on a team page. Each opens a small
// panel under the tiles (one at a time), except "Make learning material", which
// opens the assistant with the team attached.

import { useEffect, useState } from "react";
import { openAssistant, setPageTeam } from "@/lib/server/assistant/assistantBridge";
import { makePagePrompt } from "@/lib/server/teams/teamRules";
import AddDocumentPanel from "./AddDocumentPanel";
import CuratePagesPanel from "./CuratePagesPanel";
import NewsPanel from "./NewsPanel";

type Panel = "document" | "pages" | "news" | null;

const TILES: { key: "document" | "pages" | "learn" | "news"; icon: string; title: string; blurb: string }[] = [
  { key: "document", icon: "upload_file", title: "Share a document", blurb: "Upload a file or add a link." },
  { key: "pages", icon: "menu_book", title: "Curate wiki pages", blurb: "Add your pages or public ones." },
  { key: "learn", icon: "auto_awesome", title: "Make learning material", blurb: "The assistant writes a wiki page for the team." },
  { key: "news", icon: "campaign", title: "News & promote", blurb: "Post team news or share a result." },
];

export default function TeamTiles({
  teamId,
  slug,
  name,
  isLead,
}: {
  teamId: string;
  slug: string;
  name: string;
  isLead: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);

  // Tell the assistant which team this page is, so a message typed by hand
  // still makes a page for this team and stays here.
  useEffect(() => {
    setPageTeam({ id: teamId, name, slug });
    return () => setPageTeam(null);
  }, [teamId, name, slug]);

  const pick = (key: (typeof TILES)[number]["key"]) => {
    if (key === "learn") {
      setPanel(null);
      openAssistant({ text: makePagePrompt(name), mode: "fill", team: { id: teamId, name, slug } });
      return;
    }
    setPanel((p) => (p === key ? null : key));
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="team-do">
      <h2 id="team-do" className="font-headline-sm text-headline-sm text-on-background">
        What do you want to do?
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TILES.map((t) => {
          const active = (t.key === "document" || t.key === "pages" || t.key === "news") && panel === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              aria-expanded={t.key === "learn" ? undefined : active}
              className={`tile text-left p-5 flex flex-col gap-2 ${active ? "ring-2 ring-primary/50" : ""}`}
            >
              <span className="material-symbols-outlined text-primary text-[28px]">{t.icon}</span>
              <span className="font-label-lg text-label-lg text-on-background">{t.title}</span>
              <span className="font-body-sm text-body-sm text-secondary">{t.blurb}</span>
            </button>
          );
        })}
      </div>

      {panel === "document" && <AddDocumentPanel teamId={teamId} slug={slug} onClose={() => setPanel(null)} />}
      {panel === "pages" && <CuratePagesPanel teamId={teamId} slug={slug} onClose={() => setPanel(null)} />}
      {panel === "news" && <NewsPanel teamId={teamId} slug={slug} isLead={isLead} onClose={() => setPanel(null)} />}
    </section>
  );
}
