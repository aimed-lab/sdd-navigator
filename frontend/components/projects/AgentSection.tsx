"use client";

// Agent section — the project detail page's "Run agent" button and review
// flow. First agentic feature in the app: a fixed pipeline running in the
// Python backend (backend/explore-mcp/tools/project_agent.py) searches
// across all our sources, judges relevance against the project's stated
// goal, and proposes resources + checklist items. This component NEVER
// persists anything on its own — every write goes through the same
// saveToProjectAction/addChecklistItemAction Server Actions the Resources
// and Checklist sections already use, and only once the user hits Accept.
//
// ANY MEMBER may run this — running is read-only (the backend never touches
// Supabase) and reviewing/accepting reuses the same any-member-gated actions
// Resources/Checklist already allow, so there's no reason to restrict
// kicking it off to leads only.
//
// PROGRESS: polls /api/project-agent/status every 1.5s and shows which
// pipeline stage is running — a 20-40s run with a bare spinner reads as
// broken. /api/project-agent/start does the real membership check (see that
// route's own comment) and derives every field the agent reasons about
// server-side from the project — this component only ever sends a projectId.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ItemCard from "@/components/ItemCard";
import { saveToProjectAction } from "@/app/explore/actions";
import { addChecklistItemAction } from "@/app/projects/[id]/actions";
import type { ExploreItem } from "@/types/explore";

type ProposedItem = ExploreItem & { reason: string };
type ProposedChecklistItem = { label: string; rationale: string };

type AgentResult = {
  summary: string;
  selected_items: ProposedItem[];
  checklist_items: ProposedChecklistItem[];
  tools_called: string[];
  warnings: string[];
  // Set when the relevance pass itself failed (e.g. hit a quota). Per Chen's
  // review: the agent must NOT fall back to unranked search results with a
  // quiet caveat in that case — it proposes nothing, and this flag is what
  // tells the panel to say so prominently instead of rendering a review list.
  analysis_failed?: boolean;
};

type Stage = "searching" | "judging_relevance" | "proposing_checklist" | "done" | null;

const STAGE_LABEL: Record<Exclude<Stage, null>, string> = {
  searching: "Searching papers, datasets, trials, tools, and more…",
  judging_relevance: "Judging what's actually relevant to your project's goal…",
  proposing_checklist: "Proposing next steps and gaps…",
  done: "Wrapping up…",
};

const POLL_MS = 1500;

export default function AgentSection({ projectId }: { projectId: string }) {
  const router = useRouter();

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [result, setResult] = useState<AgentResult | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
  const [selectedChecklistLabels, setSelectedChecklistLabels] = useState<Set<string>>(new Set());

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptedSummary, setAcceptedSummary] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const runAgent = async () => {
    setStartError(null);
    setAcceptedSummary(null);
    setAcceptError(null);
    setResult(null);
    setRunning(true);
    setStage("searching");

    let jobId: string | null = null;
    try {
      const res = await fetch("/api/project-agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok || !data.job_id) {
        throw new Error(data.error || "Couldn't start the agent.");
      }
      jobId = data.job_id as string;
    } catch (e) {
      setRunning(false);
      setStage(null);
      setStartError(e instanceof Error ? e.message : "Couldn't start the agent.");
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/project-agent/status?job_id=${encodeURIComponent(jobId!)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lost track of the agent's progress.");

        if (data.stage) setStage(data.stage as Stage);

        if (data.status === "done" && data.result) {
          stopPolling();
          setRunning(false);
          setStage(null);
          const r = data.result as AgentResult;
          setResult(r);
          // Every item and checklist suggestion is checked by default —
          // "Accept saves only what is still checked."
          setSelectedResourceIds(new Set(r.selected_items.map((i) => i.id)));
          setSelectedChecklistLabels(new Set(r.checklist_items.map((c) => c.label)));
        }
      } catch (e) {
        stopPolling();
        setRunning(false);
        setStage(null);
        setStartError(e instanceof Error ? e.message : "Lost track of the agent's progress.");
      }
    }, POLL_MS);
  };

  const toggleResource = (id: string) => {
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleChecklist = (label: string) => {
    setSelectedChecklistLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const discard = () => {
    setResult(null);
    setAcceptError(null);
  };

  const accept = async () => {
    if (!result || accepting) return;
    setAccepting(true);
    setAcceptError(null);

    const itemsToSave = result.selected_items.filter((i) => selectedResourceIds.has(i.id));
    const checklistToAdd = result.checklist_items.filter((c) => selectedChecklistLabels.has(c.label));

    const [itemResults, checklistResults] = await Promise.all([
      Promise.all(itemsToSave.map((item) => saveToProjectAction(projectId, item))),
      Promise.all(checklistToAdd.map((c) => addChecklistItemAction(projectId, c.label))),
    ]);

    const failures = [
      ...itemResults.filter((r) => !r.ok).map((r) => r.error),
      ...checklistResults.filter((r) => !r.ok).map((r) => r.error),
    ];

    setAccepting(false);

    if (failures.length > 0) {
      setAcceptError(
        `${failures.length} item(s) couldn't be saved: ${failures[0]}${
          failures.length > 1 ? ` (and ${failures.length - 1} more)` : ""
        }`
      );
    }

    const savedCount = itemResults.filter((r) => r.ok).length;
    const addedCount = checklistResults.filter((r) => r.ok).length;
    if (savedCount > 0 || addedCount > 0) {
      setAcceptedSummary(
        `Saved ${savedCount} resource${savedCount === 1 ? "" : "s"} and added ${addedCount} checklist item${
          addedCount === 1 ? "" : "s"
        }.`
      );
      setResult(null);
      router.refresh();
    }
  };

  return (
    <section className="mb-20">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-background">Project agent</h2>
          <p className="font-body-sm text-body-sm text-secondary mt-1">
            Searches across all our sources, judges what's relevant to this project's goal, and
            proposes resources and checklist items for you to review.
          </p>
        </div>
        {!result && (
          <button
            type="button"
            onClick={runAgent}
            disabled={running}
            className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md flex items-center gap-2 shrink-0 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
            {running ? "Running…" : "Run agent"}
          </button>
        )}
      </div>

      {running && (
        <div className="glass-card rounded-2xl p-8 flex items-center gap-4">
          <span className="material-symbols-outlined text-primary text-[24px] animate-spin">
            progress_activity
          </span>
          <div>
            <p className="font-body-md text-body-md text-on-background font-medium">
              {stage ? STAGE_LABEL[stage] ?? "Working…" : "Starting…"}
            </p>
            <p className="font-body-sm text-body-sm text-secondary mt-0.5">
              This usually takes 20–40 seconds.
            </p>
          </div>
        </div>
      )}

      {startError && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {startError}
        </p>
      )}

      {acceptedSummary && !result && (
        <p className="font-body-md text-body-md text-primary">{acceptedSummary}</p>
      )}

      {/* Shown even after the review panel closes (a partial accept can
          succeed enough to clear `result` while still leaving some items
          unsaved) — this must stay visible, not disappear with the panel
          that raised it. */}
      {acceptError && !result && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {acceptError}
        </p>
      )}

      {result && result.analysis_failed && (
        <div className="glass-card rounded-2xl p-6 md:p-8 border border-error/40">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-error text-[22px]">error</span>
            <div>
              <p className="font-body-md text-body-md text-on-background font-medium">
                The agent couldn&apos;t complete its analysis.
              </p>
              <p className="font-body-sm text-body-sm text-secondary mt-1">
                {result.warnings[0] ??
                  "The relevance pass failed, so nothing is being proposed. Try again in a moment."}
              </p>
            </div>
          </div>
          <div className="mt-6">
            <button
              type="button"
              onClick={discard}
              className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {result && !result.analysis_failed && (
        <div className="glass-card rounded-2xl p-6 md:p-8">
          <p className="font-body-md text-body-md text-on-background mb-1">{result.summary}</p>
          {result.warnings.length > 0 && (
            <ul className="mb-4 space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="font-body-sm text-body-sm text-secondary">
                  {w}
                </li>
              ))}
            </ul>
          )}

          {result.selected_items.length === 0 && result.checklist_items.length === 0 ? (
            <p className="font-body-md text-body-md text-secondary mt-4">
              Nothing to propose this run.
            </p>
          ) : (
            <>
              {result.selected_items.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-label-lg text-label-lg text-on-background mb-4">
                    Proposed resources ({selectedResourceIds.size}/{result.selected_items.length}{" "}
                    selected)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {result.selected_items.map((item) => {
                      const checked = selectedResourceIds.has(item.id);
                      return (
                        <div key={item.id} className="relative">
                          <label
                            className="absolute top-3 left-3 z-10 w-6 h-6 rounded-md bg-surface-container-lowest/90 border border-outline-variant/50 flex items-center justify-center cursor-pointer shadow-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleResource(item.id)}
                              className="w-4 h-4 accent-primary cursor-pointer"
                              aria-label={`Include ${item.title}`}
                            />
                          </label>
                          <ItemCard item={item} />
                          <p className="mt-2 font-body-sm text-body-sm text-secondary italic">
                            {item.reason}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.checklist_items.length > 0 && (
                <div className="mt-8">
                  <h3 className="font-label-lg text-label-lg text-on-background mb-4">
                    Proposed checklist items ({selectedChecklistLabels.size}/
                    {result.checklist_items.length} selected)
                  </h3>
                  <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden">
                    {result.checklist_items.map((c, idx) => {
                      const checked = selectedChecklistLabels.has(c.label);
                      return (
                        <label
                          key={c.label}
                          className={
                            "flex items-start gap-3 p-4 cursor-pointer hover:bg-surface-container-low/40" +
                            (idx < result.checklist_items.length - 1
                              ? " border-b border-outline-variant/20"
                              : "")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleChecklist(c.label)}
                            className="mt-1 w-4 h-4 accent-primary cursor-pointer shrink-0"
                          />
                          <div>
                            <p className="font-body-md text-body-md text-on-background font-medium">
                              {c.label}
                            </p>
                            <p className="font-body-sm text-body-sm text-secondary mt-0.5">
                              {c.rationale}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {acceptError && (
            <p className="mt-4 font-body-sm text-body-sm text-error" role="alert">
              {acceptError}
            </p>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={accept}
              disabled={
                accepting ||
                (selectedResourceIds.size === 0 && selectedChecklistLabels.size === 0)
              }
              className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {accepting ? "Saving…" : "Accept selected"}
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={accepting}
              className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
