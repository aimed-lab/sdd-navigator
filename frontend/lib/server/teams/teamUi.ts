// lib/server/teams/teamUi.ts — small display rules for the team page, as plain
// functions so `npm test` covers them. No imports.

export type FileKind = "pdf" | "slides" | "image" | "link";

const SLIDES = /\.(pptx?|key|odp)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$/i;

/** What icon a shared document gets: by its first file's name, else it is a link. */
export function fileKind(r: { files: { filename: string }[]; url: string | null }): FileKind {
  const name = r.files[0]?.filename ?? "";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (SLIDES.test(name)) return "slides";
  if (IMAGE.test(name)) return "image";
  if (!name && r.url) {
    if (/\.pdf(\?|#|$)/i.test(r.url)) return "pdf";
    if (SLIDES.test(r.url.split(/[?#]/)[0])) return "slides";
    if (IMAGE.test(r.url.split(/[?#]/)[0])) return "image";
  }
  return "link";
}

/** Icon name and colours for each kind (PDF red, slides orange, image purple, link grey). */
export const FILE_KIND_STYLE: Record<FileKind, { icon: string; bg: string; fg: string; label: string }> = {
  pdf: { icon: "picture_as_pdf", bg: "#fde8e6", fg: "#b42318", label: "PDF" },
  slides: { icon: "slideshow", bg: "#ffedd5", fg: "#c2410c", label: "Slides" },
  image: { icon: "image", bg: "#f1e8fd", fg: "#6d28d9", label: "Image" },
  link: { icon: "public", bg: "#eceae4", fg: "#5b5a55", label: "Link" },
};

/** "+N" after the avatar stack, or "" when everyone fits. */
export function avatarOverflow(total: number, shown = 6): string {
  return total > shown ? `+${total - shown}` : "";
}

/** "by Ana · Oct 3, 2026" with whatever part is known. */
export function byLine(name: string | null | undefined, date: string): string {
  const who = name ? `by ${name}` : "";
  return [who, date].filter(Boolean).join(" · ");
}

// ── cards, photos, toasts ─────────────────────────────────────────────────────

/** An image document (first file is an image, or a link to one): shown under
 *  Photos, never under Slides & documents. */
export function isPhoto(r: { files: { filename: string }[]; url: string | null }): boolean {
  return fileKind(r) === "image";
}

/** Split a team's shared items into documents and photos. Documents keep their
 *  order (the caller pins first); photos come newest first. */
export function splitResources<T extends { files: { filename: string }[]; url: string | null; created_at: string }>(
  items: T[]
): { documents: T[]; photos: T[] } {
  const documents = items.filter((r) => !isPhoto(r));
  const photos = items.filter(isPhoto).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return { documents, photos };
}

/** The big badge on a document card's cover: SLIDES orange, PDF red, LINK blue,
 *  anything else grey. */
export const COVER_STYLE: Record<FileKind, { badge: string; bg: string; fg: string; accent: string }> = {
  slides: { badge: "SLIDES", bg: "#fff4e8", fg: "#9a3412", accent: "#ea580c" },
  pdf: { badge: "PDF", bg: "#fdecea", fg: "#991b1b", accent: "#dc2626" },
  link: { badge: "LINK", bg: "#e8f0fe", fg: "#1e40af", accent: "#2563eb" },
  image: { badge: "PHOTO", bg: "#f3e8ff", fg: "#6b21a8", accent: "#7e22ce" },
};

/** The badge for a document that is a file but not slides or a PDF ("FILE"), or a link. */
export function coverBadge(kind: FileKind, hasFile: boolean): string {
  if (kind === "link" && hasFile) return "FILE";
  return COVER_STYLE[kind].badge;
}

/** "2.4 MB", "310 KB"; "" when the size is not known. */
export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0 || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** The short toast after something is added. */
export function addedMessage(kind: FileKind): string {
  switch (kind) {
    case "slides":
      return "Slides added";
    case "pdf":
      return "PDF added";
    case "image":
      return "Photo added";
    default:
      return "Document added";
  }
}

/** Wrap an index around a list of `n` items (for next / previous in the lightbox). */
export function wrapIndex(i: number, n: number): number {
  return n <= 0 ? 0 : ((i % n) + n) % n;
}

/** A swipe of at least `min` px to the left (next, +1) or right (previous, -1); 0 for anything shorter. */
export function swipeStep(dx: number, min = 50): -1 | 0 | 1 {
  if (dx <= -min) return 1;
  if (dx >= min) return -1;
  return 0;
}

/** A stable soft hue (0-359) from a team name, for the team card's cover. */
export function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** The first line of a description, trimmed to `max` characters with an ellipsis. */
export function firstLine(text: string | null | undefined, max = 90): string {
  const line = (text ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// ── the team page: views, labels, "latest" ────────────────────────────────────

export const TEAM_VIEWS = ["slides", "learn", "photos", "people"] as const;
export type TeamView = (typeof TEAM_VIEWS)[number];

/** ?view= on /teams/[slug]: one of the four sections, else null (the team home). */
export function parseView(raw: string | string[] | undefined | null): TeamView | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (TEAM_VIEWS as readonly string[]).includes(v ?? "") ? (v as TeamView) : null;
}

export function viewHref(slug: string, view: TeamView | null): string {
  return view ? `/teams/${slug}?view=${view}` : `/teams/${slug}`;
}

export const VIEW_META: Record<TeamView, { label: string; title: string; description: string; add: string | null }> = {
  slides: { label: "Slides", title: "Slides & files", description: "Slides, PDFs and links shared with the team.", add: "Add a file" },
  learn: { label: "Learn", title: "Learn", description: "Pages that keep adding new research by themselves.", add: "Add a page" },
  photos: { label: "Photos", title: "Photos", description: "Pictures from your team. Tap one to see it full screen and share it.", add: "Add a photo" },
  people: { label: "People", title: "People", description: "Everyone on this team.", add: null },
};

const SLIDE_EXT = /\.(pptx?|key|odp)$/i;

/** "PowerPoint · 42 MB", "PDF · 120 KB", "Link", "File · 39 KB": the small line on a document's cover. */
export function typeLine(r: { files: { filename: string; sizeBytes: number }[]; url: string | null }): string {
  const first = r.files[0];
  if (!first) return "Link";
  const size = formatBytes(r.files.reduce((n, f) => n + (f.sizeBytes || 0), 0));
  const kind = fileKind(r);
  const label = kind === "pdf" ? "PDF" : SLIDE_EXT.test(first.filename) ? "PowerPoint" : "File";
  return size ? `${label} · ${size}` : label;
}

/** The team's "Start here" page first, then the rest in the order given. */
export function startHereFirst<T extends { title: string }>(pages: T[]): T[] {
  const isStart = (p: T) => /^start here/i.test(p.title.trim());
  return [...pages.filter(isStart), ...pages.filter((p) => !isStart(p))];
}

export function isStartHere(title: string): boolean {
  return /^start here/i.test(title.trim());
}

/** The line under a Learn row: "2 new papers" when the page got new evidence this
 *  week, else "Updated Oct 26", else "". */
export function learnLine(newCount: number, updatedLabel: string): string {
  if (newCount > 0) return `${newCount} new ${newCount === 1 ? "paper" : "papers"}`;
  return updatedLabel ? `Updated ${updatedLabel}` : "";
}

export type LatestKind = "slides" | "learn" | "photos";
export type LatestItem = { key: string; kind: LatestKind; title: string; at: string };

/** The newest `n` items across documents, photos and wiki pages, newest first. */
export function latestItems(
  input: {
    resources: { id: string; title: string; created_at: string; files: { filename: string }[]; url: string | null }[];
    pages: { pageId: string; title: string; createdAt: string }[];
  },
  n = 3
): LatestItem[] {
  const all: LatestItem[] = [
    ...input.resources.map((r) => ({ key: `r:${r.id}`, kind: (isPhoto(r) ? "photos" : "slides") as LatestKind, title: r.title, at: r.created_at })),
    ...input.pages.map((p) => ({ key: `p:${p.pageId}`, kind: "learn" as LatestKind, title: p.title, at: p.createdAt })),
  ];
  return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, n);
}

/** The small grey line under each tile. */
export function tileCount(kind: "slides" | "learn" | "photos" | "people", n: number): string {
  if (kind === "slides") return `${n} ${n === 1 ? "file" : "files"}`;
  if (kind === "learn") return `${n} ${n === 1 ? "page" : "pages"}`;
  return String(n);
}
