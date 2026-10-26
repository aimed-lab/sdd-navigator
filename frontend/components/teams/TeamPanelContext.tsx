"use client";

// Which tile panel is open on a team page. A tile opens one under the tile
// row; the "+ Add" buttons on the cards below open the same panels, so the
// state lives here, above both.

import { createContext, useCallback, useContext, useState } from "react";

export type TeamPanel = "document" | "pages" | "share" | null;

type Ctx = {
  panel: TeamPanel;
  open: (p: Exclude<TeamPanel, null>) => void;
  toggle: (p: Exclude<TeamPanel, null>) => void;
  close: () => void;
};

const PanelCtx = createContext<Ctx | null>(null);

export function TeamPanelProvider({
  children,
  initialPanel = null,
}: {
  children: React.ReactNode;
  /** A panel to have open on arrival (a tile the visitor clicked before joining). */
  initialPanel?: TeamPanel;
}) {
  const [panel, setPanel] = useState<TeamPanel>(initialPanel);
  const open = useCallback((p: Exclude<TeamPanel, null>) => {
    setPanel(p);
    // Bring the panel (it sits right under the tiles) into view.
    window.setTimeout(() => document.getElementById("team-do")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, []);
  const toggle = useCallback((p: Exclude<TeamPanel, null>) => setPanel((cur) => (cur === p ? null : p)), []);
  const close = useCallback(() => setPanel(null), []);
  return <PanelCtx.Provider value={{ panel, open, toggle, close }}>{children}</PanelCtx.Provider>;
}

export function useTeamPanel(): Ctx {
  const c = useContext(PanelCtx);
  if (!c) throw new Error("useTeamPanel must be used inside TeamPanelProvider");
  return c;
}
