// lib/server/communityHome/resourceFile.ts — the rules for a file attached to a
// team or community document: what is allowed, where it is stored, and what to
// tell the person when the upload fails. Used by the browser (to check before
// uploading and to explain a refusal) and by the server (to check again).
// No imports, so `npm test` covers it.
//
// The bytes never pass through our server: the browser uploads straight to
// Supabase Storage with a signed upload URL, so Next.js's server-action body
// limit (1 MB by default) and Vercel's 4.5 MB request limit do not apply.

export const MAX_RESOURCE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB, the bucket's own limit
export const RESOURCE_FILE_BUCKET = "community-resource-files";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const RESOURCE_FILE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  pptx: PPTX_MIME,
};

const ALLOWED_MIME = new Set(Object.values(RESOURCE_FILE_MIME_BY_EXT));

export const FILE_TYPES_HINT = "PNG, JPEG, WebP, GIF, PDF or PPTX";

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

/** The MIME type to upload as. Some browsers (Windows without Office, Linux)
 *  report an empty or generic type for a .pptx, so the extension decides when the
 *  reported type is not one we allow. Null when the file is not an allowed kind. */
export function resourceFileMime(name: string, reportedType: string): string | null {
  if (ALLOWED_MIME.has(reportedType)) return reportedType;
  const byExt = RESOURCE_FILE_MIME_BY_EXT[extOf(name)];
  return byExt ?? null;
}

export type FileCheck = { ok: true; mime: string } | { ok: false; error: string };

export function checkResourceFile(file: { name: string; size: number; type: string }): FileCheck {
  if (!file.size) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_RESOURCE_FILE_BYTES) return { ok: false, error: "File is too large (max 50 MB)." };
  const mime = resourceFileMime(file.name, file.type);
  if (!mime) return { ok: false, error: `That file type isn't allowed. Use ${FILE_TYPES_HINT}.` };
  return { ok: true, mime };
}

/** A file name safe to use in a storage path: no slashes or odd characters,
 *  the extension kept, never empty. */
export function safeFilename(name: string): string {
  const cleaned = name.trim()
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(-120);
  return cleaned || "file";
}

/** `<community id>/<resource id>/<file name>`: the community id first, which the
 *  storage policies read to decide who may upload and read. */
export function resourceFilePath(communityId: string, resourceId: string, filename: string): string {
  return `${communityId}/${resourceId}/${safeFilename(filename)}`;
}

/** True when a path a browser sends back really sits under this community and
 *  resource (so it cannot register somebody else's object). */
export function pathBelongsTo(path: unknown, communityId: string, resourceId: string): path is string {
  if (typeof path !== "string") return false;
  const prefix = `${communityId}/${resourceId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("..");
}

/** Plain words for a refused upload, from the storage service's answer. */
export function uploadFailureMessage(status: number, body: string): string {
  const text = body.toLowerCase();
  if (status === 413 || text.includes("exceeded the maximum") || text.includes("too large") || text.includes("payload")) {
    return "File is too large (max 50 MB).";
  }
  if (text.includes("mime") || status === 415) {
    return `That file type isn't allowed. Use ${FILE_TYPES_HINT}.`;
  }
  if (status === 401 || status === 403 || text.includes("row-level security") || text.includes("unauthorized")) {
    return "Upload not allowed: you can only add files to a team you are on. Sign in again and retry.";
  }
  if (status === 404 || text.includes("bucket not found")) {
    return "Upload is not set up on the server (the storage bucket is missing). Tell the site admin.";
  }
  if (status === 409 || text.includes("already exists")) {
    return "A file with that name was already uploaded. Try again.";
  }
  if (status === 0) return "The upload was interrupted. Check your connection and try again.";
  return `The upload failed (error ${status}). Try again, and tell the site admin if it keeps happening.`;
}
