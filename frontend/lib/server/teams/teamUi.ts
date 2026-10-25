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
