// The PHGDH case-study route (Prof. Chen's Basel talk). ONE file for every
// link, so any of them can be swapped later in one place. The homepage map
// (components/DiscoveryMap.tsx) and the numbered list under it
// (components/PhgdhRouteList.tsx) both read PHGDH_STEPS below.
//
// External links (http...) open in a new tab and show a ↗. `locked` marks the
// invite-only step, drawn with the map's usual lock style.

export const PHGDH_LINKS = {
  papers: "/explore/Alzheimer's%20disease",
  alert: "/invite?interest=alerts", // locked
  collection: "/phgdh",
  analysis: "https://wiki.smartdrugdiscovery.org/PHGDH-Allosteric-RBD-Binder/Project-Dashboard",
  patent: "https://www.smartdrugdiscovery.org/post/phgdh2025",
  join: "https://www.smartdrugdiscovery.org/open-ip-gating",
} as const;

export type PhgdhStep = {
  key: keyof typeof PHGDH_LINKS;
  /** Station label on the map. */
  station: string;
  /** One short line in the numbered list under the map. */
  listText: string;
  href: string;
  locked?: boolean;
};

export const PHGDH_STEPS: PhgdhStep[] = [
  {
    key: "papers",
    station: "Alzheimer's papers",
    listText: "Explore Alzheimer's papers on the hub",
    href: PHGDH_LINKS.papers,
  },
  {
    key: "alert",
    station: "PHGDH alert",
    listText: "Get alerted when PHGDH keeps showing up",
    href: PHGDH_LINKS.alert,
    locked: true,
  },
  {
    key: "collection",
    station: "PHGDH collection",
    listText: "Collect PHGDH papers, data, tools and trials in one place",
    href: PHGDH_LINKS.collection,
  },
  {
    key: "analysis",
    station: "Analysis",
    listText: "Analyze PHGDH: see the project dashboard",
    href: PHGDH_LINKS.analysis,
  },
  {
    key: "patent",
    station: "Patent pilot",
    listText: "Open patent pilot: read about it",
    href: PHGDH_LINKS.patent,
  },
  {
    key: "join",
    station: "Promote & join",
    listText: "Promote it and invite collaborators: join the call",
    href: PHGDH_LINKS.join,
  },
];

export const isExternal = (href: string) => /^https?:\/\//.test(href);
