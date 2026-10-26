// lib/siteMode.ts — "teams mode": the same app deployed a second time as a
// teams-only site (project.smartdrugdiscovery.org), switched on by
// NEXT_PUBLIC_SITE_MODE=teams at build time. Missing or any other value means
// the normal site, unchanged. Dependency-free so next.config.ts, server and
// client components, and `npm test` can all import it.

export function isTeamsMode(value: string | undefined): boolean {
  return value === "teams";
}

/** True in a build made with NEXT_PUBLIC_SITE_MODE=teams. */
export const TEAMS_MODE = isTeamsMode(process.env.NEXT_PUBLIC_SITE_MODE);

export const TEAMS_BRAND = "SmartDrugDiscovery Teams";

/** Drug-discovery routes that do not exist in teams mode. Each also covers its
 *  sub-paths (/explore/<topic>, /collaborate/providers/<slug>, ...). */
export const TEAMS_MODE_BLOCKED = [
  "/explore",
  "/collaborate",
  "/promote",
  "/communities",
  "/phgdh",
  "/researchers",
  "/projects",
  "/saved",
  "/start",
] as const;

/** next.config redirects for teams mode; empty in the normal site. */
export function teamsModeRedirects(teams: boolean): { source: string; destination: string; permanent: boolean }[] {
  if (!teams) return [];
  return TEAMS_MODE_BLOCKED.flatMap((p) => [
    { source: p, destination: "/", permanent: false },
    { source: `${p}/:path*`, destination: "/", permanent: false },
  ]);
}

export type NavLink = { label: string; href: string };

/** The centre links of the top menu. */
export function navPillars(teams: boolean): NavLink[] {
  return teams
    ? [
        { label: "Teams", href: "/" },
        { label: "My pages", href: "/pages" },
      ]
    : [
        { label: "Explore", href: "/explore" },
        { label: "Collaborate", href: "/collaborate" },
        { label: "Promote", href: "/promote" },
      ];
}

/** Account-menu links shown between "My teams" and "Settings". */
export function accountLinks(teams: boolean): NavLink[] {
  return teams
    ? [{ label: "My pages", href: "/pages" }]
    : [
        { label: "My projects", href: "/projects" },
        { label: "My pages", href: "/pages" },
        { label: "Saved items", href: "/saved" },
      ];
}

/** Footer links; minimal in teams mode. */
export function footerLinks(teams: boolean): NavLink[] {
  return teams
    ? [{ label: "Contact", href: "/contact" }]
    : [
        { label: "About", href: "/about" },
        { label: "Explore", href: "/explore" },
        { label: "Collaborate", href: "/collaborate" },
        { label: "Promote", href: "/promote" },
        { label: "Contact", href: "/contact" },
      ];
}

/** Page title: "<title> · SmartDrugDiscovery" normally, "... Teams" in teams mode. */
export function siteTitle(title: string, teams: boolean = TEAMS_MODE): string {
  return `${title} · ${teams ? TEAMS_BRAND : "SmartDrugDiscovery"}`;
}
