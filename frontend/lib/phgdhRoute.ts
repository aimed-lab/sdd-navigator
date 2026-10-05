// The PHGDH case: the worked example of how the hub's three functions (Explore,
// Collaborate, Promote) fit together. ONE file for every link, so any of them
// can be swapped later in one place. The homepage map
// (components/DiscoveryMap.tsx) and the grouped step list under it
// (components/PhgdhRouteList.tsx) both read PHGDH_STEPS below, in this order.
//
// External links (http...) open in a new tab and show a ↗. `locked` marks the
// invite-only step, drawn with the map's usual lock style.

export const PHGDH_LINKS = {
  papers: "/explore/Alzheimer's%20disease",
  alert: "/invite?interest=alerts", // locked
  collection: "/phgdh",
  analysis: "https://wiki.smartdrugdiscovery.org/PHGDH-Allosteric-RBD-Binder/Project-Dashboard",
  patent: "https://www.smartdrugdiscovery.org/post/phgdh2025",
  join: "https://www.smartdrugdiscovery.org/open-ip-gating", // the PHGDH call
  promote: "/promote",
} as const;

/** The three functions, same words as the nav. */
export type PhgdhGroup = "Explore" | "Collaborate" | "Promote";

export type PhgdhStep = {
  key: "papers" | "alert" | "collection" | "analysis" | "patent" | "join";
  group: PhgdhGroup;
  /** Station label on the map. */
  station: string;
  /** One short line in the step list. */
  listText: string;
  /** The station's link, and the whole-line link in the list (unless `listLinks`). */
  href: string;
  locked?: boolean;
  /** Steps whose line holds more than one link (the line itself is not a link). */
  listLinks?: { label: string; href: string }[];
};

export const PHGDH_STEPS: PhgdhStep[] = [
  {
    key: "papers",
    group: "Explore",
    station: "Alzheimer's papers",
    listText: "Explore Alzheimer's papers on the hub",
    href: PHGDH_LINKS.papers,
  },
  {
    key: "alert",
    group: "Explore",
    station: "PHGDH alert",
    listText: "Get alerted when PHGDH keeps showing up",
    href: PHGDH_LINKS.alert,
    locked: true,
  },
  {
    key: "collection",
    group: "Explore",
    station: "PHGDH collection",
    listText: "Collect PHGDH papers, data, tools and trials in one place",
    href: PHGDH_LINKS.collection,
  },
  {
    key: "analysis",
    group: "Collaborate",
    station: "Analysis",
    listText: "Analyze PHGDH together: see the project dashboard",
    href: PHGDH_LINKS.analysis,
  },
  {
    key: "patent",
    group: "Promote",
    station: "Patent pilot",
    listText: "The open patent pilot: read about it",
    href: PHGDH_LINKS.patent,
  },
  {
    key: "join",
    group: "Promote",
    station: "Join & promote",
    listText: "The PHGDH call is open:",
    href: PHGDH_LINKS.promote,
    listLinks: [
      { label: "Join the call", href: PHGDH_LINKS.join },
      { label: "Promote your own work", href: PHGDH_LINKS.promote },
    ],
  },
];

export const GROUPS: PhgdhGroup[] = ["Explore", "Collaborate", "Promote"];

export const isExternal = (href: string) => /^https?:\/\//.test(href);
