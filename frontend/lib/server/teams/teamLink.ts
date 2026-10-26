// lib/server/teams/teamLink.ts — what a scanned QR code or a pasted link may
// send someone to. Only a team page on this site, or on one of the two
// SmartDrugDiscovery hosts that run this app, is accepted; the result is a
// relative path, so the visitor always lands on the site they are using now.
// No imports, so `npm test` covers it.

/** Hosts that serve this app besides the one the visitor is on. */
export const TEAM_LINK_HOSTS = ["project.smartdrugdiscovery.org", "connect.smartdrugdiscovery.org"] as const;

const TEAM_PATH = /^\/teams\/([a-z0-9][a-z0-9-]{0,199})\/?$/;

export type TeamLink = { ok: true; slug: string; path: string } | { ok: false };

/** A team link from raw text. `currentOrigin` is the site the visitor is on
 *  (window.location.origin). Query string and hash are ignored. */
export function parseTeamLink(raw: unknown, currentOrigin: string): TeamLink {
  if (typeof raw !== "string") return { ok: false };
  const text = raw.trim();
  if (!text || text.length > 2048) return { ok: false };

  let url: URL;
  try {
    // A bare path ("/teams/alpha") is read against the current site.
    url = text.startsWith("/") && !text.startsWith("//") ? new URL(text, currentOrigin) : new URL(text);
  } catch {
    return { ok: false };
  }

  let here: URL;
  try {
    here = new URL(currentOrigin);
  } catch {
    return { ok: false };
  }

  const sameSite = url.origin === here.origin;
  const knownHost = url.protocol === "https:" && (TEAM_LINK_HOSTS as readonly string[]).includes(url.hostname) && !url.port;
  if (!sameSite && !knownHost) return { ok: false };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false };
  if (url.username || url.password) return { ok: false };

  const m = TEAM_PATH.exec(url.pathname);
  if (!m || m[1] === "new") return { ok: false };
  return { ok: true, slug: m[1], path: `/teams/${m[1]}` };
}
