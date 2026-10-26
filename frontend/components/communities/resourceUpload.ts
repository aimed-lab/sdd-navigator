// Browser side of a document upload, shared by a team's "Share a document", its
// "Share a photo" option and the community Resources form. The file goes
// straight from the browser to Supabase Storage with a signed upload URL, so it
// never passes through a Server Action (1 MB default limit) or Vercel (4.5 MB).
//
//   1. prepare (server): checks the person and the file, returns a signed URL
//   2. PUT the file to that URL (with progress)
//   3. write the rows (server): for a NEW document the row is created only now,
//      so a failed upload leaves nothing behind
//
// Every failure comes back as { ok: false, error } with a reason in plain words;
// nothing throws and nothing fails silently.

import {
  attachResourceUploadAction,
  createResourceWithUploadAction,
  prepareResourceUploadAction,
} from "@/app/communities/actions";
import { checkResourceFile, uploadFailureMessage } from "@/lib/server/communityHome/resourceFile";
import type { CommunityResourceFile } from "@/lib/server/communities";

export type OnProgress = (percent: number) => void;

const UNEXPECTED = "Something went wrong while uploading. Please try again.";

/** PUT the file to a signed upload URL (the same request supabase-js makes). */
function putFile(signedUrl: string, file: File, onProgress?: OnProgress): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: uploadFailureMessage(xhr.status, xhr.responseText ?? "") });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: uploadFailureMessage(0, "") });
    xhr.onabort = () => resolve({ ok: false, error: uploadFailureMessage(0, "") });
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

/** The file as it will be uploaded: some browsers report no type for a .pptx, so
 *  the type is set from the extension. */
function asUpload(file: File, mime: string): File {
  return file.type === mime ? file : new File([file], file.name, { type: mime });
}

/** A new document with a file (and optionally a link). All or nothing. */
export async function createResourceWithFile(args: {
  communityId: string;
  slug: string;
  input: { title: string; resource_type: string; url: string; description: string };
  file: File;
  onProgress?: OnProgress;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { communityId, slug, input, file, onProgress } = args;
  const check = checkResourceFile(file);
  if (!check.ok) return check;
  try {
    const prep = await prepareResourceUploadAction(communityId, { name: file.name, size: file.size, type: file.type });
    if (!prep.ok) return prep;

    const put = await putFile(prep.signedUrl, asUpload(file, check.mime), onProgress);
    if (!put.ok) return put;

    const made = await createResourceWithUploadAction(communityId, slug, input, {
      resourceId: prep.resourceId,
      path: prep.path,
      filename: file.name,
    });
    return made.ok ? { ok: true, id: made.id } : made;
  } catch (e) {
    console.error("createResourceWithFile failed", e);
    return { ok: false, error: UNEXPECTED };
  }
}

/** A file for a document that already exists. */
export async function attachFileToResource(args: {
  communityId: string;
  resourceId: string;
  file: File;
  onProgress?: OnProgress;
}): Promise<{ ok: true; file: CommunityResourceFile } | { ok: false; error: string }> {
  const { communityId, resourceId, file, onProgress } = args;
  const check = checkResourceFile(file);
  if (!check.ok) return check;
  try {
    const prep = await prepareResourceUploadAction(communityId, { name: file.name, size: file.size, type: file.type }, resourceId);
    if (!prep.ok) return prep;

    const put = await putFile(prep.signedUrl, asUpload(file, check.mime), onProgress);
    if (!put.ok) return put;

    return await attachResourceUploadAction(communityId, resourceId, { path: prep.path, filename: file.name });
  } catch (e) {
    console.error("attachFileToResource failed", e);
    return { ok: false, error: UNEXPECTED };
  }
}
