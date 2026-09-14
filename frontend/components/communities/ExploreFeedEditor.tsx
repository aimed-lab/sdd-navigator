"use client";

// Admin control over the community's Explore feed — inside "Manage
// community", next to SectionsEditor, same structural idiom (local state
// initialized from the page's current values, nothing persisted until
// Save). Two separate actions, not one:
//
//   Save   — writes explore_sources/explore_topics. Takes effect only the
//            NEXT time Refresh runs; saving alone never touches the stored
//            feed a member currently sees.
//   Refresh — runs the CURRENTLY SAVED sources/topics and replaces the
//            stored feed (updateCommunityExploreConfigAction ->
//            refreshCommunityFeedAction, not the other way — Refresh always
//            operates on what's actually in the database, so a Refresh
//            click after editing but before Save would refresh against the
//            OLD config; the button below is disabled while there are
//            unsaved edits specifically to avoid that confusing case).
//
// "None selected" is valid and means "no feed", not "every source" — see
// EXPLORE_SOURCE_KEYS' own comment in lib/communityTypes.ts.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  refreshCommunityFeedAction,
  updateCommunityExploreConfigAction,
} from "@/app/communities/actions";
import { EXPLORE_SOURCE_KEYS, EXPLORE_SOURCE_LABEL, type ExploreSourceKind } from "@/lib/communityTypes";
import type { SourceOutcome } from "@/lib/server/communities";

function formatRefreshedAt(iso: string | null): string {
  if (!iso) return "Never refreshed.";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never refreshed.";
  return `Last refreshed ${d.toLocaleString()}.`;
}

export default function ExploreFeedEditor({
  communityId,
  slug,
  sources,
  topics,
  refreshedAt,
  paperScope,
  grantActivityCodes,
}: {
  communityId: string;
  slug: string;
  sources: ExploreSourceKind[];
  topics: string[];
  refreshedAt: string | null;
  /** 'all' (default) or 'clinical' — narrows the Papers source to health-
   *  services/clinical literature instead of unrestricted biomedical text
   *  search. See sources/pubmed.py's own comment for what this actually
   *  does; a bare keyword topic can't express it, which is why this is a
   *  separate control rather than something to write into Topics. */
  paperScope: "all" | "clinical";
  /** NIH activity codes (e.g. ["K99","R00","K23","K01"]) the Grants source
   *  should keep — empty means no career-stage filter. */
  grantActivityCodes: string[];
}) {
  const router = useRouter();
  const [localSources, setLocalSources] = useState<ExploreSourceKind[]>(sources);
  const [topicsText, setTopicsText] = useState(topics.join("\n"));
  const [localPaperScope, setLocalPaperScope] = useState<"all" | "clinical">(paperScope);
  const [activityCodesText, setActivityCodesText] = useState(grantActivityCodes.join(", "));
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(refreshedAt);
  // What the LAST Refresh click actually did — an admin about to show this
  // feed to someone needs to know it worked, not just that the button was
  // clicked. `emptySources` is shown on both outcomes: on success it's a
  // partial-result note ("Trials: nothing"), on failure it's every
  // configured source, since nothing came back from any of them.
  const [outcome, setOutcome] = useState<{
    ok: boolean;
    message: string;
    emptySources: SourceOutcome[];
  } | null>(null);

  const toggleSource = (kind: ExploreSourceKind) => {
    setDirty(true);
    setSaved(false);
    setLocalSources((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
    );
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const topicsList = topicsText
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    const activityCodesList = activityCodesText
      .split(/[,\n]/)
      .map((c) => c.trim())
      .filter(Boolean);
    const res = await updateCommunityExploreConfigAction(
      communityId,
      localSources,
      topicsList,
      slug,
      localPaperScope,
      activityCodesList
    );
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setDirty(false);
      router.refresh();
    } else {
      setSaveError(res.error);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setOutcome(null);
    const res = await refreshCommunityFeedAction(communityId, slug);
    setRefreshing(false);
    if (res.ok) {
      setLastRefreshedAt(new Date().toISOString());
      setOutcome({
        ok: true,
        message: `Found ${res.count} item${res.count === 1 ? "" : "s"}.`,
        emptySources: res.emptySources,
      });
      router.refresh();
    } else {
      setOutcome({ ok: false, message: res.error, emptySources: res.emptySources });
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-outline-variant/20 pt-8">
      <h3 className="font-label-lg text-label-lg text-on-background">Explore feed</h3>
      <p className="font-body-sm text-body-sm text-secondary">
        Pick which Explore sources this community searches and the topics that drive it. The
        Explore section shows whatever the last Refresh found, not a live search — members see
        the same feed until an admin refreshes it.
      </p>

      <div>
        <p className="font-label-sm text-label-sm text-on-background mb-2">Sources</p>
        <ul className="rounded-lg border border-outline-variant/30 divide-y divide-outline-variant/20 grid grid-cols-1 sm:grid-cols-2">
          {EXPLORE_SOURCE_KEYS.map((kind) => (
            <li key={kind} className="flex items-center px-4 py-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSources.includes(kind)}
                  onChange={() => toggleSource(kind)}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                <span className="font-body-sm text-body-sm text-on-background">
                  {EXPLORE_SOURCE_LABEL[kind]}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <label className="font-label-sm text-label-sm text-on-background mb-2 block">
          Topics
        </label>
        <p className="font-body-sm text-body-sm text-secondary mb-2">
          One keyword or phrase per line — what the search actually runs on. The purpose line
          above is for people to read; it isn&apos;t specific enough to drive a search.
        </p>
        <textarea
          value={topicsText}
          onChange={(e) => {
            setTopicsText(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
          rows={3}
          placeholder={"e.g. PHGDH\nglioblastoma metabolism"}
          className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 font-body-sm text-body-sm text-on-background bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={localPaperScope === "clinical"}
            onChange={(e) => {
              setLocalPaperScope(e.target.checked ? "clinical" : "all");
              setDirty(true);
              setSaved(false);
            }}
            className="w-4 h-4 accent-primary cursor-pointer"
          />
          <span className="font-body-sm text-body-sm text-on-background">
            Prioritize clinical / health-services literature over basic science
          </span>
        </label>
        <p className="font-body-sm text-body-sm text-secondary mt-1 ml-6">
          For a topic like the same disease name, a plain keyword search can&apos;t tell a
          mechanism paper from a health-services one — this narrows Papers to
          clinical/health-services literature specifically.
        </p>
      </div>

      <div>
        <label className="font-label-sm text-label-sm text-on-background mb-2 block">
          Grant career stage (optional)
        </label>
        <p className="font-body-sm text-body-sm text-secondary mb-2">
          NIH activity codes this community is eligible for (e.g. K99, R00, K23, K01, R03).
          Comma-separated. Leave blank to show every stage, including R01/U01 — the default.
        </p>
        <input
          type="text"
          value={activityCodesText}
          onChange={(e) => {
            setActivityCodesText(e.target.value);
            setDirty(true);
            setSaved(false);
          }}
          placeholder="e.g. K99, R00, K23, K01, R03"
          className="w-full rounded-lg border border-outline-variant/30 px-3 py-2 font-body-sm text-body-sm text-on-background bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-outline px-5 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !saveError && (
          <span className="font-body-sm text-body-sm text-primary">Saved.</span>
        )}
        {saveError && (
          <span className="font-body-sm text-body-sm text-error" role="alert">
            {saveError}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-outline-variant/20 pt-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || dirty}
            title={dirty ? "Save your changes before refreshing" : undefined}
            className="btn-primary px-5 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <span className="font-body-sm text-body-sm text-secondary">
            {dirty ? "Save your changes first." : formatRefreshedAt(lastRefreshedAt)}
          </span>
        </div>

        {outcome && (() => {
          const rejected = outcome.emptySources.filter((s) => s.reason === "rejected");
          const empty = outcome.emptySources.filter((s) => s.reason === "empty");
          const label = (kind: string) => EXPLORE_SOURCE_LABEL[kind as ExploreSourceKind] ?? kind;
          return (
            <div className="flex flex-col gap-0.5">
              <span
                className={
                  "font-body-sm text-body-sm " + (outcome.ok ? "text-primary" : "text-error")
                }
                role={outcome.ok ? undefined : "alert"}
              >
                {outcome.ok ? outcome.message : `Refresh failed — ${outcome.message}`}
              </span>
              {/* "Rejected" and "empty" are kept visually apart — a source
                  the backend refused to answer (bad/missing token, backend
                  down, ...) is a problem to go fix, not a topic that simply
                  had nothing this time. */}
              {rejected.length > 0 && (
                <span className="font-body-sm text-body-sm text-error">
                  Backend rejected the request for: {rejected.map((s) => label(s.kind)).join(", ")}.
                </span>
              )}
              {empty.length > 0 && (
                <span className="font-body-sm text-body-sm text-secondary">
                  No results for: {empty.map((s) => label(s.kind)).join(", ")}.
                </span>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
