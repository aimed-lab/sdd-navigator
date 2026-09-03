"use client";

// The community's Resources section — same shape as AnnouncementsSection.
// Read is member-only, write is admin-only — enforced in the database
// (RLS: is_community_member for SELECT, is_community_admin for
// INSERT/UPDATE/DELETE — see
// database/migrations/2026-09-03_community_resources.sql), not by hiding
// the add form here: a non-member never receives any rows in the first
// place (the page only fetches when isMember, same reasoning as
// listAnnouncements/listMemberRoster).
//
// GROUPED BY TYPE, same pattern as MembersSection's role groups: a small
// uppercase label per non-empty group, in a fixed order, each group
// internally keeping whatever order it already had in the (server-sorted)
// list.
//
// ADDED-BY NAME comes from `authorNames` (built in the page from
// listMemberRoster()/community_member_roster()), never from an email —
// same reasoning and same "Unknown" fallback as AnnouncementsSection.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCommunityResourceAction,
  deleteCommunityResourceAction,
  updateCommunityResourceAction,
} from "@/app/communities/actions";
import type { CommunityResource } from "@/lib/server/communities";
import { COMMUNITY_RESOURCE_TYPES, type CommunityResourceType } from "@/lib/communityTypes";
import CollapsibleSection from "./CollapsibleSection";

type ActionResult = { ok: true } | { ok: false; error: string };

const TYPE_LABEL: Record<CommunityResourceType, string> = {
  tool: "Tools",
  paper: "Papers",
  dataset: "Datasets",
  link: "Links",
  podcast: "Podcasts",
  other: "Other",
};

// Same list/order as COMMUNITY_RESOURCE_TYPES (lib/communityTypes.ts,
// mirrors the DB's own CHECK constraint) — kept as a separate constant here
// only because TYPE_LABEL needs the exact same order for its group headings.
const TYPE_ORDER: CommunityResourceType[] = COMMUNITY_RESOURCE_TYPES;

/** Shared by both "Add resource" and "Edit" — same fields, same validation
 *  (title required; url optional but must be http(s) if given — re-checked
 *  server-side in lib/server/communities.ts's safeResourceUrl, this is only
 *  the input type, not a bypassable gate). */
function ResourceForm({
  initialTitle = "",
  initialType = "tool",
  initialUrl = "",
  initialDescription = "",
  busyLabel,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initialTitle?: string;
  initialType?: CommunityResourceType;
  initialUrl?: string;
  initialDescription?: string;
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !title.trim()) return;

    setSaving(true);
    setError(null);
    const res = await onSubmit({
      title: title.trim(),
      resource_type: resourceType,
      url: url.trim(),
      description: description.trim(),
    });
    if (res.ok) {
      router.refresh();
      onCancel();
    } else {
      setError(res.error);
      setSaving(false);
    }
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
          className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <select
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value as CommunityResourceType)}
          aria-label="Resource type"
          className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
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
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        aria-label="Resource description"
        rows={3}
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
      />
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
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
      </div>
    </form>
  );
}

/** Same dialog shell as DeleteAnnouncementConfirm/LeaveButton's
 *  LeaveConfirm — confirm before a destructive action, not a native
 *  confirm(). */
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
  return (
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
    </div>
  );
}

function ResourceItem({
  resource,
  addedByName,
  communityId,
  slug,
  isAdmin,
}: {
  resource: CommunityResource;
  addedByName: string;
  communityId: string;
  slug: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (editing) {
    return (
      <ResourceForm
        initialTitle={resource.title}
        initialType={resource.resource_type}
        initialUrl={resource.url ?? ""}
        initialDescription={resource.description}
        busyLabel="Saving…"
        submitLabel="Save"
        onCancel={() => setEditing(false)}
        onSubmit={(input) => updateCommunityResourceAction(communityId, resource.id, slug, input)}
      />
    );
  }

  return (
    <>
      <article className="rounded-xl bg-surface-container-low p-4">
        {resource.url ? (
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-headline-sm text-headline-sm text-primary hover:underline underline-offset-4"
          >
            {resource.title}
          </a>
        ) : (
          <h3 className="font-headline-sm text-headline-sm text-on-background">
            {resource.title}
          </h3>
        )}
        {resource.description && (
          <p className="mt-2 font-body-md text-body-md text-secondary whitespace-pre-wrap">
            {resource.description}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2 font-body-sm text-body-sm text-secondary/70">
          <span className="truncate">Added by {addedByName}</span>
          {isAdmin && (
            <span className="ml-auto flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="font-label-sm text-label-sm text-secondary hover:text-error transition-colors"
              >
                Delete
              </button>
            </span>
          )}
        </div>
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
  addedByNames,
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
  /** user_id -> display name, from listMemberRoster()/
   *  community_member_roster() (built in the page) — never an email. */
  addedByNames: Record<string, string>;
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
                  <ul className="flex flex-col gap-3">
                    {group.map((r) => (
                      <li key={r.id}>
                        <ResourceItem
                          resource={r}
                          addedByName={addedByNames[r.added_by] ?? "Unknown"}
                          communityId={communityId}
                          slug={slug}
                          isAdmin={isAdmin}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
