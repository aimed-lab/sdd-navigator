// lib/server/teams/photoShare.ts — the rules behind "Share a photo" on a team
// page, as plain functions so `npm test` covers them. No imports.

/** Longest side, in pixels, the photo is resized to before sharing. */
export const PHOTO_MAX_SIDE = 1600;

/** The starting caption: built only from this team's name and description. */
export function photoCaption(teamName: string, description: string | null | undefined): string {
  const name = teamName.trim();
  const desc = (description ?? "").trim();
  return desc ? `At ${name} - ${desc}` : `At ${name}`;
}

export type ShareRoute = "native" | "fallback";

/** Native share sheet when the browser can share this file, else the manual buttons. */
export function shareRoute(
  nav: { canShare?: (data: { files: File[] }) => boolean; share?: unknown } | undefined,
  photo: File | null,
): ShareRoute {
  if (!nav || !photo || typeof nav.share !== "function" || typeof nav.canShare !== "function") return "fallback";
  try {
    return nav.canShare({ files: [photo] }) ? "native" : "fallback";
  } catch {
    return "fallback";
  }
}

export function linkedInUrl(caption: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(caption)}`;
}

export function xUrl(caption: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`;
}

export const FACEBOOK_URL = "https://www.facebook.com/";

/** Size to scale a width x height image to so its longest side is at most max. */
export function fitWithin(w: number, h: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const k = max / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
