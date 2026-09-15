"use client";

// The community's Resources section — what the community itself offers,
// hand-curated by an admin (tools, links, papers, the podcast, the RFA —
// whatever "Add resource" was used for). Same shape as
// AnnouncementsSection. Read is member-only, write is admin-only —
// enforced in the database (RLS: is_community_member for SELECT,
// is_community_admin for INSERT/UPDATE/DELETE — see
// database/migrations/2026-09-03_community_resources.sql), not by hiding
// the add form here: a non-member never receives any rows in the first
// place (the page only fetches when isMember, same reasoning as
// listAnnouncements/listMemberRoster).
//
// GENERATED (Explore-found) items live in their own section now —
// ExploreSection.tsx, a sibling in the same section system, independently
// enabled/reordered — NOT here. Splitting this apart from that one is the
// whole point of this file's current shape: a community's own curated
// offerings and whatever an agent found are two different claims ("this is
// what we have" vs. "this is what Explore turned up"), and conflating them
// under one heading made it impossible to want one without the other.
//
// GROUPED BY TYPE, same pattern as MembersSection's role groups: a small
// uppercase label per non-empty group, in a fixed order, each group
// internally keeping whatever order it already had in the (server-sorted)
// list.
//
// ADDED-BY is not shown on the card right now — see ResourceItem's own
// comment on why, and where it comes back.
//
// CARD SURFACE is `glass-panel` (app/globals.css) — same static, non-lifting
// glass surface Promote's ShowcaseCard uses for its own grid cards, not the
// flat `bg-surface-container-low` block this used to be. Same reasoning:
// each card needs its own distinct edge, not ten blocks butted flush
// together with no visual separation.
//
// TYPE ICON + LABEL: RESOURCE_TYPE_ICON below is this file's own map (no
// equivalent existed anywhere else — ShowcaseCard's SHOWCASE_TYPE_ICON is a
// DIFFERENT vocabulary, showcase entry types, not community resource
// types). A small type chip on the card itself, not just the group heading
// above it, since the heading scrolls out of view while the cards
// underneath keep scrolling past.
//
// ADMIN EDIT/DELETE is a hover-revealed kebab menu, absolutely positioned
// over the top-right corner — copied from ShowcaseCard's ownerMenu pattern
// verbatim (same classes, same group/group-hover mechanics, same
// click-outside catcher), not a second implementation of the same idea.
// This is a browsing surface; Edit/Delete at the same visual weight as the
// title and description read as an admin table, not a card someone reads.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  addCommunityResourceFileAction,
  createCommunityResourceAction,
  deleteCommunityResourceAction,
  removeCommunityResourceFileAction,
  updateCommunityResourceAction,
} from "@/app/communities/actions";
import type { CommunityResource, CommunityResourceFile } from "@/lib/server/communities";
import { COMMUNITY_RESOURCE_TYPES, type CommunityResourceType } from "@/lib/communityTypes";
import CollapsibleSection from "./CollapsibleSection";

// id is optional here specifically so this one type covers both
// createCommunityResourceAction's result (carries the new row's id, needed
// so ResourceForm can attach files to a resource it just created) and
// updateCommunityResourceAction's (no id — the resource already had one).
type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const MAX_RESOURCE_FILE_BYTES = 50 * 1024 * 1024;
const RESOURCE_FILE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Attach/remove files on one resource — admin-only, embedded in
 *  ResourceForm. Only rendered once a resourceId exists: for "Add
 *  resource", that means only after the text fields have been saved once
 *  (a resource is created in one shot, not as a lazy draft the way a
 *  Promote article is — see ResourceForm's own comment); for "Edit", the
 *  resourceId is there from the start, so this appears immediately.
 *  Mirrors components/promote/MediaUploader.tsx's upload/remove logic
 *  (same accept list, same 50 MB cap, same client-side pre-check before the
 *  round trip), simplified since there's no lazy-id resolution to do here. */
function ResourceFileUploader({
  communityId,
  resourceId,
  initialFiles,
}: {
  communityId: string;
  resourceId: string;
  initialFiles: CommunityResourceFile[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<CommunityResourceFile[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const uploadFile = async (file: File) => {
    setFileError(null);
    if (file.size > MAX_RESOURCE_FILE_BYTES) {
      setFileError(`"${file.name}" is over 50 MB.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("communityId", communityId);
      fd.set("resourceId", resourceId);
      fd.set("file", file);
      const res = await addCommunityResourceFileAction(fd);
      if (res.ok) setFiles((f) => [...f, res.file]);
      else setFileError(res.error);
    } finally {
      setUploading(false);
    }
  };

  const uploadFiles = async (fileList: FileList | null) => {
    for (const file of Array.from(fileList ?? [])) await uploadFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeFile = async (fileId: string) => {
    setFileError(null);
    const res = await removeCommunityResourceFileAction(communityId, resourceId, fileId);
    if (res.ok) setFiles((f) => f.filter((x) => x.id !== fileId));
    else setFileError(res.error);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-label-sm text-label-sm text-secondary">
        Files — PNG, JPEG, WebP, GIF, PDF or PPTX, up to 50 MB each.
      </span>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-primary text-base shrink-0">
                  description
                </span>
                <span className="font-body-sm text-body-sm text-on-background truncate">
                  {f.filename}
                </span>
                <span className="font-label-sm text-label-sm text-secondary shrink-0">
                  {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                className="shrink-0 font-label-sm text-label-sm text-error hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {fileError && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {fileError}
        </p>
      )}

      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-outline-variant/50 rounded-lg py-4 cursor-pointer hover:bg-surface-container-low transition-all">
        <span className="material-symbols-outlined text-lg text-primary">
          {uploading ? "hourglass_top" : "upload"}
        </span>
        <span className="font-label-sm text-label-sm text-on-background">
          {uploading ? "Uploading…" : "Add a file"}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept={RESOURCE_FILE_ACCEPT}
          multiple
          disabled={uploading}
          onChange={(e) => uploadFiles(e.target.files)}
          className="sr-only"
        />
      </label>
    </div>
  );
}

const TYPE_LABEL: Record<CommunityResourceType, string> = {
  tool: "Tools",
  paper: "Papers",
  dataset: "Datasets",
  link: "Links",
  podcast: "Podcasts",
  other: "Other",
};

// Material Symbols name per type — a flask for a tool, a document for a
// paper, a link glyph for a link, a waveform for a podcast, matching the
// spec's own wording as closely as the icon set allows ("science" IS a
// flask glyph in Material Symbols, "article" a lined document, "podcasts"
// a broadcast/waveform mark). "other" reuses ShowcaseCard's own
// DEFAULT_SHOWCASE_TYPE_ICON value (auto_awesome) rather than picking a
// fresh generic icon — same fallback meaning, same glyph.
const TYPE_ICON: Record<CommunityResourceType, string> = {
  tool: "science",
  paper: "article",
  dataset: "dataset",
  link: "link",
  podcast: "podcasts",
  other: "auto_awesome",
};

// Per-type colour, reusing lib/showcaseTypes.ts's SHOWCASE_TYPE_COVER
// approach verbatim rather than inventing a second mapping: this palette
// only has three real hue families (primary/green, secondary, tertiary —
// secondary and tertiary are themselves close neighbors, #565e74 vs
// #505f76), so SHOWCASE_TYPE_COVER pairs two categories per hue at
// different intensities (paper=primary/10, award=primary/20; talk=
// secondary/10, tool=secondary-container/60) rather than pretending there
// are six distinct hues. Same trick here, and the SAME literal classes
// where the type already has a showcase equivalent:
//   green (primary):    paper (light — identical to showcase's own
//                        "paper" entry) / dataset (stronger tint, same
//                        primary/20 intensity showcase uses for "award")
//   secondary:          link (plain secondary/10, same as showcase's
//                        "talk") / tool (secondary-container/60, same
//                        exact entry showcase already uses for ITS "tool")
//   tertiary:           podcast (tertiary/10, same treatment as showcase's
//                        "poster") — alone in this family, since 5 real
//                        types don't split evenly into 3 pairs
//   neutral (no hue):   other — same surface-container-high/
//                        on-surface-variant treatment as showcase's own
//                        "other"
// `bar` is now a LEFT edge accent (border-l, not the earlier top bar — see
// ResourceItem's own comment on why), one flat colour per kind. `chipBg`/
// `chipText` fill the icon's circle badge, same hue.
const TYPE_COLOR: Record<CommunityResourceType, { bar: string; chipBg: string; chipText: string }> = {
  paper: { bar: "border-l-primary", chipBg: "bg-primary/10", chipText: "text-primary" },
  dataset: { bar: "border-l-primary", chipBg: "bg-primary/20", chipText: "text-primary" },
  link: { bar: "border-l-secondary", chipBg: "bg-secondary/10", chipText: "text-secondary" },
  tool: {
    bar: "border-l-secondary",
    chipBg: "bg-secondary-container/60",
    chipText: "text-on-secondary-container",
  },
  podcast: { bar: "border-l-tertiary", chipBg: "bg-tertiary/10", chipText: "text-tertiary" },
  other: {
    bar: "border-l-outline-variant",
    chipBg: "bg-surface-container-high",
    chipText: "text-on-surface-variant",
  },
};

// Same list/order as COMMUNITY_RESOURCE_TYPES (lib/communityTypes.ts,
// mirrors the DB's own CHECK constraint) — kept as a separate constant here
// only because TYPE_LABEL needs the exact same order for its group headings.
const TYPE_ORDER: CommunityResourceType[] = COMMUNITY_RESOURCE_TYPES;

/** Shared by both "Add resource" and "Edit" — same fields, same validation
 *  (title required; url optional but must be http(s) if given — re-checked
 *  server-side in lib/server/communities.ts's safeResourceUrl, this is only
 *  the input type, not a bypassable gate).
 *
 *  FILE ATTACHMENT: a resource is created in one shot (title + type + url +
 *  description together), not as a lazy draft row the way a Promote
 *  article is — so there is no resource_id to attach a file to until that
 *  first save succeeds. For "Edit" (resourceId passed in from the start),
 *  the file uploader is available immediately. For "Add resource"
 *  (resourceId undefined), the Add button saves the text fields as before,
 *  but instead of closing, the form then shows the file uploader against
 *  the row it just created (createdResourceId) and swaps its own submit
 *  button for "Done" — resubmitting the text fields a second time makes no
 *  sense once the row exists, so submit is guarded against firing again. */
function ResourceForm({
  communityId,
  resourceId,
  initialTitle = "",
  initialType = "tool",
  initialUrl = "",
  initialDescription = "",
  initialFiles = [],
  busyLabel,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  communityId: string;
  /** Set only when editing a resource that already exists. Undefined for
   *  "Add resource" until the first save succeeds. */
  resourceId?: string;
  initialTitle?: string;
  initialType?: CommunityResourceType;
  initialUrl?: string;
  initialDescription?: string;
  initialFiles?: CommunityResourceFile[];
  busyLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: {
    title: string;
    resource_type: string;
    url: string;
    description: string;
  }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [resourceType, setResourceType] = useState<CommunityResourceType>(initialType);
  const [url, setUrl] = useState(initialUrl);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only ever set on the "Add resource" path, once the row has been
  // created — see the function comment above.
  const [createdResourceId, setCreatedResourceId] = useState<string | null>(null);

  const effectiveResourceId = resourceId ?? createdResourceId;
  const fieldsLocked = !resourceId && createdResourceId !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !title.trim() || fieldsLocked) return;

    setSaving(true);
    setError(null);
    const res = await onSubmit({
      title: title.trim(),
      resource_type: resourceType,
      url: url.trim(),
      description: description.trim(),
    });
    if (res.ok) {
      if (resourceId) {
        // Editing an existing row — done immediately, same as before.
        router.refresh();
        onCancel();
      } else if (res.id) {
        // Just created — keep the form open so files can be attached.
        setCreatedResourceId(res.id);
        setSaving(false);
      } else {
        // Defensive: createCommunityResourceAction should always return an
        // id on success. If it somehow doesn't, don't leave the form stuck.
        router.refresh();
        onCancel();
      }
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  const finish = () => {
    router.refresh();
    onCancel();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Resource title"
          disabled={fieldsLocked}
          className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
        <select
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as CommunityResourceType)}
          aria-label="Resource type"
          disabled={fieldsLocked}
          className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https:// link (optional)"
        aria-label="Resource URL"
        disabled={fieldsLocked}
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        aria-label="Resource description"
        rows={3}
        disabled={fieldsLocked}
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y disabled:opacity-60"
      />

      {effectiveResourceId && (
        <ResourceFileUploader
          communityId={communityId}
          resourceId={effectiveResourceId}
          initialFiles={initialFiles}
        />
      )}

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {fieldsLocked ? (
          <button
            type="button"
            onClick={finish}
            className="btn-primary px-4 py-2 rounded-lg font-label-sm text-label-sm"
          >
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="btn-primary px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
            >
              {saving ? busyLabel : submitLabel}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/** Same dialog shell as DeleteAnnouncementConfirm/LeaveButton's
 *  LeaveConfirm — confirm before a destructive action, not a native
 *  confirm().
 *
 *  PORTALED TO document.body — this card grid now lives inside
 *  CollapsibleSection's own `glass-panel` wrapper (same surface treatment
 *  ResourceItem's cards themselves now use), and `.glass-panel` sets
 *  `backdrop-filter: blur(12px)` (app/globals.css). Per the CSS spec, an
 *  element with `backdrop-filter` becomes the CONTAINING BLOCK for any
 *  `position: fixed` descendant — so without the portal, this dialog's
 *  "fixed inset-0" computed relative to that glass-panel section's box,
 *  not the viewport. Verified in the browser (getBoundingClientRect): the
 *  backdrop rect came back sized to the Resources card
 *  ({x:190, y:96, w:1310, h:862}) instead of the actual viewport, the
 *  exact same measured symptom as SaveItemPicker.tsx's own version of this
 *  bug (see that file's comment) — same fix here, not a new pattern. */
function DeleteResourceConfirm({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // document.body doesn't exist during SSR — same guard SaveItemPicker.tsx
  // uses for the same reason.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete "${title}"`}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">warning</span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Delete this resource?
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary truncate">{title}</p>
          </div>
        </div>

        {error && (
          <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ResourceItem({
  resource,
  communityId,
  slug,
  isAdmin,
}: {
  resource: CommunityResource;
  communityId: string;
  slug: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  if (editing) {
    return (
      <ResourceForm
        communityId={communityId}
        resourceId={resource.id}
        initialTitle={resource.title}
        initialType={resource.resource_type}
        initialUrl={resource.url ?? ""}
        initialDescription={resource.description}
        initialFiles={resource.files}
        busyLabel="Saving…"
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={(input) => updateCommunityResourceAction(communityId, resource.id, slug, input)}
      />
    );
  }

  const color = TYPE_COLOR[resource.resource_type];

  return (
    <>
      {/* LEFT border, not the earlier top bar — reads as a category marker
          running alongside the content rather than a decorative strip
          along an edge nothing else touches. No shadow anywhere on this
          card: it sits on glass-panel (blur + translucency already), and
          nothing else in this app uses drop shadows — a shadow on ten
          identical, non-clickable-as-a-whole cards would signal nothing.
          More generous padding/gaps (p-7, gap-4) instead — verified in the
          browser that the earlier p-6/gap-2 read as CRAMPED, not merely
          "missing elevation": there was no dead space for the eye to rest
          in between icon, title and description. */}
      <article
        className={`glass-panel rounded-2xl border-l-[3px] ${color.bar} p-7 relative group flex flex-col gap-4`}
      >
        {/* Admin actions — hover-revealed kebab menu, absolutely positioned
            over the corner so it never occupies layout space, copied
            verbatim from components/promote/ShowcaseCard.tsx's ownerMenu
            (same classes, same group/group-hover mechanics, same
            click-outside catcher) rather than a second implementation. */}
        {isAdmin && (
          <div className="absolute top-3 right-3 z-10">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-label="Resource actions"
              className="w-8 h-8 rounded-full bg-surface-container-lowest/90 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow-sm"
            >
              <span className="material-symbols-outlined text-secondary text-lg">more_vert</span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 w-32 rounded-lg bg-surface-container-lowest shadow-lg border border-outline-variant/30 overflow-hidden z-20">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing(true);
                    }}
                    className="block w-full text-left px-4 py-2 font-label-sm text-label-sm text-on-background hover:bg-surface-container-low"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmingDelete(true);
                    }}
                    className="block w-full text-left px-4 py-2 font-label-sm text-label-sm text-error hover:bg-surface-container-low"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Type icon in a filled, tinted circle — this is where the visual
            weight now sits, since the icon is the part actually carrying
            meaning (which of six types this is), not the label text next
            to it. Previously the icon just floated inline next to the
            label at body size, no more visually significant than any other
            piece of text on the card. The label stays plain tinted text
            beside the circle, not a second pill — one filled shape per
            card reads as a badge; two competing tinted shapes would not. */}
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${color.chipBg}`}
          >
            <span className={`material-symbols-outlined text-xl ${color.chipText}`}>
              {TYPE_ICON[resource.resource_type]}
            </span>
          </div>
          <span
            className={`font-label-sm text-label-sm uppercase tracking-wide ${color.chipText}`}
          >
            {TYPE_LABEL[resource.resource_type]}
          </span>
        </div>

        {/* Title — a link (with an external-link glyph) when there's a URL;
            deliberately NOT link-colored/underlined otherwise. A resource
            with no URL used to render in the same weight as a link minus
            the color, which next to a page full of green linked titles
            reads as a broken link, not a description — GeneTerrain and
            BEERE are both in this state today. text-secondary (this
            codebase's standard de-emphasized-text token, same one "Added
            by" and every meta line already uses) reads unambiguously as
            "not a link" rather than "a link that didn't render".
            SIZE/WEIGHT: `font-headline-sm text-headline-sm` used to be
            here, and is again — but at the time this card was built,
            neither was a real Tailwind utility in this project's config
            (no "headline-sm" entry anywhere in tailwind.config.ts), so the
            title was silently rendering at the browser default (measured:
            16px/400 Inter), one step above the 14px/400 description —
            exactly why nothing anchored the eye. Patched at the time with
            `text-xl font-semibold` (real, always-defined utilities, same
            20px/600 numbers) as a stopgap. Now that headline-sm exists as
            a real token (tailwind.config.ts — 20px/28px/600, filling the
            gap between headline-md and body-lg the four OTHER call sites
            had independently hit the same hole on), switched back to it:
            identical size/weight, but Geist (this app's headline
            typeface) instead of Inter (body text) — reverified below. */}
        {resource.url ? (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1.5 font-headline-sm text-headline-sm text-primary hover:underline underline-offset-4"
          >
            <span>{resource.title}</span>
            <span className="material-symbols-outlined text-[18px] shrink-0 translate-y-1">
              open_in_new
            </span>
          </a>
        ) : (
          <h3 className="font-headline-sm text-headline-sm text-secondary">{resource.title}</h3>
        )}

        {/* Clamped to two lines — the full text belongs on the linked
            destination (or, for an unlinked item, there's nowhere else it
            needs to go in full), not spelled out here at 140 characters a
            line. */}
        {resource.description && (
          <p className="font-body-sm text-body-sm text-secondary line-clamp-2">
            {resource.description}
          </p>
        )}

        {/* Attached files — download links, same filename+size shape as
         *  MediaUploader's list, minted as signed URLs server-side
         *  (listCommunityResources -> listCommunityResourceFilesForCommunity)
         *  per request. Any active member can see and download these; only
         *  an admin can attach/remove one (via Edit, above). */}
        {resource.files.length > 0 && (
          <ul className="flex flex-col gap-1">
            {resource.files.map((f) => (
              <li key={f.id}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-body-sm text-body-sm text-primary hover:underline min-w-0"
                >
                  <span className="material-symbols-outlined text-[16px] shrink-0">description</span>
                  <span className="truncate">{f.filename}</span>
                  <span className="text-secondary shrink-0">
                    {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        {/* No "Added by <name>" here right now — removed, not just hidden.
         *  Every resource today is admin-added, so `resource.added_by` is
         *  the same one or two people on every card in a section; the
         *  conditional-on-distinct-contributors version of this line was
         *  never actually right either. `added_by` STAYS on the row in the
         *  database — once non-admin members can contribute resources,
         *  attribution becomes the point (who found this), and at that
         *  point it should show on every card unconditionally, not behind
         *  a distinct-contributor check. */}
      </article>

      {confirmingDelete && (
        <DeleteResourceConfirm
          title={resource.title}
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            setConfirmingDelete(false);
            setDeleteError(null);
          }}
          onConfirm={async () => {
            setDeleting(true);
            setDeleteError(null);
            const res = await deleteCommunityResourceAction(communityId, resource.id, slug);
            if (res.ok) {
              router.refresh();
            } else {
              setDeleteError(res.error);
              setDeleting(false);
            }
          }}
        />
      )}
    </>
  );
}

export default function ResourcesSection({
  title,
  communityId,
  slug,
  defaultOpen,
  isAdmin,
  resources,
}: {
  title: string;
  communityId: string;
  slug: string;
  defaultOpen?: boolean;
  /** Every add/edit/delete control below is gated on this — the RLS
   *  policies (see the migration) are the real gate; this just decides
   *  whether to render the affordance at all. */
  isAdmin: boolean;
  resources: CommunityResource[];
}) {
  const [adding, setAdding] = useState(false);

  // Owns its own CollapsibleSection, same reason as AnnouncementsSection:
  // the header's "Add resource" button and the add form below share the
  // same `adding` state, which has to live in one client component.
  return (
    <CollapsibleSection
      title={title}
      count={resources.length}
      defaultOpen={defaultOpen}
      action={
        isAdmin && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm shrink-0"
          >
            Add resource
          </button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {isAdmin && adding && (
          <ResourceForm
            communityId={communityId}
            busyLabel="Adding…"
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={(input) => createCommunityResourceAction(communityId, slug, input)}
          />
        )}

        {resources.length === 0 ? (
          <p className="font-body-md text-body-md text-secondary">Nothing here yet.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {TYPE_ORDER.map((type) => {
              const group = resources.filter((r) => r.resource_type === type);
              if (group.length === 0) return null;
              return (
                <div key={type}>
                  <span className="block font-label-sm text-label-sm text-secondary/70 uppercase mb-2">
                    {TYPE_LABEL[type]}
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {group.map((r) => (
                      <ResourceItem
                        key={r.id}
                        resource={r}
                        communityId={communityId}
                        slug={slug}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
