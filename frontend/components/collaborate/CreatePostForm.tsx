"use client";

// Create-post form. Layout follows
// design/stitch/smartdrugdiscovery_create_collaboration_post, restyled in the
// shared design system.
//
// Only rendered for a signed-in user — app/collaborate/new/page.tsx shows the
// sign-in gate instead when signed out. createPostAction re-checks server-side
// regardless, so the gate is UX, not the enforcement.
//
// THE CHECKLIST BRIDGE: a project's "Ask for help" link routes here with
// query params (read by app/collaborate/new/page.tsx and passed down as the
// props below) — the checklist item's label seeds "needs", the project's
// name/description seed title/description, and checklistItemId rides along
// to createPostAction so the new post's checklist_item_id links back to the
// item. `returnTo` is where Cancel and a successful submit both go — the
// project page when this came from there, /collaborate otherwise.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPostAction } from "@/app/collaborate/actions";
import {
  FUNDING_STATUS_LABEL,
  FUNDING_STATUSES,
  STAGES,
  type FundingStatus,
  type Stage,
} from "@/lib/collabTypes";

const STAGE_LABEL: Record<Stage, string> = {
  concept: "Concept phase",
  early_data: "Early data",
  validation: "In-progress validation",
  preclinical: "Pre-clinical",
  seeking_team: "Seeking a team",
};

// The DOM <select> only ever holds strings, so "unspecified" needs its own
// sentinel value distinct from any real FundingStatus — converted back to
// null (the actual "unspecified" value the DB and everything downstream
// understands) at submit time, never stored or sent as this string.
const UNSPECIFIED = "" as const;

/** Add-pill input: type a value, Enter or "Add" to commit, × to remove. */
function PillInput({
  label,
  hint,
  placeholder,
  tone,
  items,
  setItems,
}: {
  label: string;
  hint: string;
  placeholder: string;
  tone: "offer" | "need";
  items: string[];
  setItems: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const pill =
    tone === "offer"
      ? "bg-primary/5 text-on-surface-variant"
      : "bg-secondary-container/40 text-on-surface-variant";

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    // case-insensitive dedupe — "CryoEM" and "cryoem" are the same tag
    if (!items.some((i) => i.toLowerCase() === v.toLowerCase())) setItems([...items, v]);
    setDraft("");
  };

  return (
    <section className="glass-panel rounded-2xl p-6">
      <h2 className="font-headline-md text-lg text-on-background">{label}</h2>
      <p className="mt-1 font-body-sm text-body-sm text-secondary">{hint}</p>

      <div className="flex gap-2 mt-4">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();   // never submit the whole form from here
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={add}
          className="btn-outline px-5 py-3 rounded-lg font-label-md text-label-md shrink-0"
        >
          Add
        </button>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {items.map((item) => (
            <span
              key={item}
              className={`inline-flex items-center gap-2 pl-3 pr-2 py-1 rounded-full font-body-sm text-body-sm ${pill}`}
            >
              {item}
              <button
                type="button"
                onClick={() => setItems(items.filter((i) => i !== item))}
                aria-label={`Remove ${item}`}
                className="text-secondary hover:text-error transition-colors"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export default function CreatePostForm({
  initialTitle = "",
  initialDescription = "",
  initialNeed,
  checklistItemId,
  returnTo = "/collaborate",
}: {
  initialTitle?: string;
  initialDescription?: string;
  /** Seeds the "needs" pill group with one entry — the checklist item's
   *  own label. Not the same shape as `initialTitle`/`-Description`
   *  (those are plain strings) because "needs" is itself a list; this is
   *  just the one value it starts with. */
  initialNeed?: string;
  checklistItemId?: string;
  returnTo?: string;
} = {}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [areas, setAreas] = useState<string[]>([]);
  const [haves, setHaves] = useState<string[]>([]);
  const [needs, setNeeds] = useState<string[]>(initialNeed?.trim() ? [initialNeed.trim()] : []);
  const [stage, setStage] = useState<Stage>("concept");
  const [fundingStatus, setFundingStatus] = useState<FundingStatus | typeof UNSPECIFIED>(
    UNSPECIFIED
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError("A title is required.");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await createPostAction({
      title,
      description,
      research_areas: areas,
      haves,
      needs,
      stage,
      funding_status: fundingStatus === UNSPECIFIED ? null : fundingStatus,
      checklist_item_id: checklistItemId ?? null,
    });

    if (res.ok) {
      router.push(returnTo);
      router.refresh();
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* About */}
      <section className="glass-panel rounded-2xl p-6 space-y-5">
        <h2 className="font-headline-md text-lg text-on-background">About</h2>

        <div>
          <label htmlFor="title" className="block font-label-md text-label-md text-on-background mb-2">
            Post title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. AI-driven PHGDH inhibitor discovery for glioblastoma"
            className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block font-label-md text-label-md text-on-background mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your goal or approach in a few sentences"
            className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </section>

      <PillInput
        label="Research areas"
        hint="Helps people find your post on the board."
        placeholder="e.g. Oncology"
        tone="offer"
        items={areas}
        setItems={setAreas}
      />

      <PillInput
        label="I have / I'm offering"
        hint="Resources, methods, equipment or expertise your lab can bring."
        placeholder="Add a resource or skill…"
        tone="offer"
        items={haves}
        setItems={setHaves}
      />

      <PillInput
        label="I need / I'm seeking"
        hint="What you're looking for — capabilities, collaborators, or materials."
        placeholder="Add a requirement…"
        tone="need"
        items={needs}
        setItems={setNeeds}
      />

      {/* Details */}
      <section className="glass-panel rounded-2xl p-6">
        <h2 className="font-headline-md text-lg text-on-background mb-4">Details</h2>
        <label htmlFor="stage" className="block font-label-md text-label-md text-on-background mb-2">
          Project stage
        </label>
        <select
          id="stage"
          value={stage}
          onChange={(e) => setStage(e.target.value as Stage)}
          className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>

        {/* Optional — unlike stage, "unspecified" is a real, first-class
            choice here, not just the initial value. */}
        <label
          htmlFor="funding_status"
          className="block font-label-md text-label-md text-on-background mb-2 mt-5"
        >
          Funding status{" "}
          <span className="text-secondary font-body-sm">(optional)</span>
        </label>
        <select
          id="funding_status"
          value={fundingStatus}
          onChange={(e) =>
            setFundingStatus(e.target.value as FundingStatus | typeof UNSPECIFIED)
          }
          className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value={UNSPECIFIED}>Prefer not to say</option>
          {FUNDING_STATUSES.map((f) => (
            <option key={f} value={f}>
              {FUNDING_STATUS_LABEL[f]}
            </option>
          ))}
        </select>
      </section>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link
          href={returnTo}
          className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {saving ? "Publishing…" : "Publish post"}
        </button>
      </div>
    </form>
  );
}
