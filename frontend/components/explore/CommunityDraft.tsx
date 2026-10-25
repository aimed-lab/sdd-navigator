"use client";

// The assistant's draft of a new community or team: a name and a one-line
// purpose the researcher can edit, then the usual confirm step, then (only on
// Create) the existing create action. Only site admins may start a community,
// so for everyone else the draft is a TEAM and says so; a site admin chooses.
// The assistant only proposes; nothing is created until Create is clicked.

import { useState } from "react";
import Link from "next/link";
import { NON_ADMIN_COMMUNITY_NOTE } from "@/lib/server/assistant/teamIntent";
import {
  joinSentences,
  MAX_COMMUNITY_NAME_CHARS,
  MAX_COMMUNITY_PURPOSE_CHARS,
  communityDraftProblem,
  type CreateCommunityAction,
} from "@/lib/server/assistant/assistantReply";

export type DraftStage = "edit" | "confirm" | "creating" | { done: string } | { error: string };

export default function CommunityDraft({
  draft,
  kind,
  canChoose,
  onKind,
  stage,
  signedIn,
  authLoading,
  onChange,
  onStage,
  onCreate,
}: {
  draft: CreateCommunityAction;
  /** What will be created. Null while a site admin has not chosen yet. */
  kind: "team" | "community" | null;
  /** True for a site admin: they pick team or community. */
  canChoose: boolean;
  onKind: (k: "team" | "community") => void;
  stage: DraftStage;
  signedIn: boolean;
  authLoading: boolean;
  onChange: (d: CreateCommunityAction) => void;
  onStage: (s: DraftStage) => void;
  onCreate: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const noun = kind === "team" ? "team" : "community";

  if (typeof stage === "object" && "done" in stage) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 flex flex-col gap-3" role="status">
        <p className="font-body-md text-body-md text-on-background">
          {kind === "team"
            ? "I created a team for you. You are its Lead."
            : "Your community is ready. You're its admin."}
        </p>
        <Link
          href={kind === "team" ? `/teams/${stage.done}` : `/communities/${stage.done}`}
          className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md"
        >
          {kind === "team" ? "Open your team" : "Open your community"}
        </Link>
      </div>
    );
  }

  if (stage === "creating") {
    return (
      <p className="font-body-md text-body-md text-secondary animate-pulse" role="status">
        Creating your {noun}…
      </p>
    );
  }

  if (stage === "confirm" || (typeof stage === "object" && "error" in stage)) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 flex flex-col gap-3">
        <p className="font-body-md text-body-md text-on-background">
          Create {noun} &lsquo;{draft.name}&rsquo;?
        </p>
        <p className="font-body-sm text-body-sm text-secondary">
          {joinSentences([
            draft.purpose,
            kind === "team"
              ? "You'll be its Lead. Anyone with the link or QR code can join; what the team shares stays private."
              : "You'll be its admin; people ask to join and you approve them.",
          ])}
        </p>
        {!canChoose && (
          <p className="font-body-sm text-body-sm text-secondary">
            {NON_ADMIN_COMMUNITY_NOTE}
          </p>
        )}
        {!authLoading && !signedIn && (
          <p className="font-body-sm text-body-sm text-secondary">You&apos;ll be asked to sign in first.</p>
        )}
        {typeof stage === "object" && "error" in stage && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {stage.error}
          </p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCreate}
            disabled={authLoading}
            className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {typeof stage === "object" ? "Try again" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => onStage("edit")}
            className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="rounded-xl border border-outline-variant/40 bg-white p-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const p = !kind ? "Choose a team or a community." : communityDraftProblem(draft.name, draft.purpose);
        setProblem(p);
        if (!p) onStage("confirm");
      }}
    >
      <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">
        {kind === "team" ? "Draft team" : kind === "community" ? "Draft community" : "Draft"}
      </span>
      {canChoose ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="font-label-md text-label-md text-on-background">What do you want to create?</legend>
          <label className="flex items-start gap-2 font-body-sm text-body-sm text-on-background">
            <input type="radio" name="draft-kind" checked={kind === "team"} onChange={() => onKind("team")} className="mt-1" />
            <span>
              <strong className="font-semibold">A team</strong>: a small private group for a few people.
            </span>
          </label>
          <label className="flex items-start gap-2 font-body-sm text-body-sm text-on-background">
            <input type="radio" name="draft-kind" checked={kind === "community"} onChange={() => onKind("community")} className="mt-1" />
            <span>
              <strong className="font-semibold">A community</strong>: public and long-lived, with many teams.
            </span>
          </label>
        </fieldset>
      ) : (
        <p className="font-body-sm text-body-sm text-secondary">
          {NON_ADMIN_COMMUNITY_NOTE} A team is a small private group.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">Name</span>
        <input
          value={draft.name}
          maxLength={MAX_COMMUNITY_NAME_CHARS}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-label-md text-label-md text-on-background">What it&apos;s for (one line)</span>
        <textarea
          value={draft.purpose}
          rows={2}
          maxLength={MAX_COMMUNITY_PURPOSE_CHARS}
          onChange={(e) => onChange({ ...draft, purpose: e.target.value })}
          className="resize-none bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>
      {problem && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {problem}
        </p>
      )}
      <button type="submit" className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md">
        Continue
      </button>
    </form>
  );
}
