"use client";

// Project agent section — the project detail page's ONE "Run agent" button.
// One click, one search, two outputs from it: a downloadable, dated digest
// (papers/tools/datasets/trials found for this project's target and
// mechanism — see MarkdownView below) rendered immediately, and the existing
// review screen of proposed resources + checklist items below it.
//
// This used to be TWO separate actions/buttons — "Run agent" and "Prior-art
// brief" — each running its OWN full search (its own explore_async() call,
// its own scope-extraction/routing Groq calls) over the same goal text to
// produce two outputs a researcher asked for with one click. The backend
// (tools/project_agent.py) now runs that search ONCE and returns both
// outputs from it; POST /api/prior-art-brief no longer exists. This
// component reflects that: one button, one request
// (/api/project-agent/start + /api/project-agent/status poll), one `result`
// carrying both `digest` and the resource/checklist proposals.
//
// This component NEVER persists anything on its own — every write goes
// through the same saveToProjectAction/addChecklistItemAction Server Actions
// the Resources and Checklist sections already use, and only once the user
// hits Accept. The digest is never persisted anywhere; Download .md is the
// only way to keep a copy (see CLAUDE.md-adjacent note: it belongs in the
// project wiki once that exists, not blocked on here).
//
// ANY MEMBER may run this — it's read-only against Supabase (the backend
// route never writes), and accepting reuses the same any-member-gated
// actions Resources/Checklist already allow.
//
// PROGRESS: polls /api/project-agent/status every 1.5s and shows which
// pipeline stage is running — a 20-40s run with a bare spinner reads as
// broken. /api/project-agent/start does the real membership check (see that
// route's own comment) and derives every field the agent reasons about
// server-side from the project — this component only ever sends a
// projectId.
//
// MARKDOWN RENDERING (digest): a small hand-written renderer for exactly the
// subset the backend generator emits (# / ## / ### headers, **bold**,
// [text](url) links, > blockquotes, - list items, | table |, italics
// *text*) rather than pulling in a markdown library for one document shape
// this codebase fully controls the format of.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ItemCard from "@/components/ItemCard";
import { saveToProjectAction } from "@/app/explore/actions";
import { addChecklistItemAction } from "@/app/projects/[id]/actions";
import type { ExploreItem } from "@/types/explore";

type ProposedItem = ExploreItem & { reason: string };
type ProposedChecklistItem = { label: string; rationale: string };

type Digest = {
  markdown: string;
  generated_at: string;
  counts: Record<string, number>;
};

type AgentResult = {
  summary: string;
  selected_items: ProposedItem[];
  checklist_items: ProposedChecklistItem[];
  // False for a ColaboFest project — the backend skips the checklist step
  // entirely there (see run_project_agent_async in tools/project_agent.py),
  // so checklist_items is always []. The existing `.length > 0` guards below
  // already keep an empty checklist section from rendering either way; this
  // field isn't needed to suppress the heading, only to make the reason
  // (suppressed by design vs. genuinely found nothing) inspectable here too.
  checklist_enabled?: boolean;
  // The downloadable digest, rendered from the SAME search as the proposals
  // above — null only when the search itself failed entirely (see
  // run_project_agent_async's own docstring). NOT gated on the relevance
  // pass succeeding: it never calls an LLM, so it's still present even when
  // analysis_failed is true.
  digest: Digest | null;
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

// ── markdown rendering (brief only) — see module docstring ───────────────────

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // [text](url) | **bold** | *italic* | `code`
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${i++}`;
    if (match[1] !== undefined) {
      nodes.push(
        <a
          key={key}
          href={match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:opacity-80"
        >
          {match[1]}
        </a>
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-on-background">
          {match[3]}
        </strong>
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-surface-container-low text-on-background">
          {match[4]}
        </code>
      );
    } else if (match[5] !== undefined) {
      nodes.push(<em key={key}>{match[5]}</em>);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownView({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("| ") || line.startsWith("|-")) {
      // table: header row, separator row, body rows
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s-:|]+\|$/.test(l))
        .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
      const [header, ...body] = rows;
      blocks.push(
        <div key={`tbl-${key++}`} className="overflow-x-auto my-3">
          <table className="min-w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-outline-variant/40">
                {header?.map((c, ci) => (
                  <th key={ci} className="py-1.5 pr-4 font-label-sm text-label-sm text-secondary">
                    {renderInline(c, `th-${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-b border-outline-variant/20">
                  {row.map((c, ci) => (
                    <td key={ci} className="py-1.5 pr-4 font-body-sm text-body-sm">
                      {renderInline(c, `td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={key++} className="font-title-sm text-title-sm text-on-background mt-4 mb-1">
          {renderInline(line.slice(4), `h3-${key}`)}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(
        <h2
          key={key++}
          className="font-title-md text-title-md text-on-background mt-6 mb-2 pb-1 border-b border-outline-variant/30"
        >
          {renderInline(line.slice(3), `h2-${key}`)}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push(
        <h1 key={key++} className="font-title-lg text-title-lg text-on-background mb-1">
          {renderInline(line.slice(2), `h1-${key}`)}
        </h1>
      );
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-4 border-primary/40 pl-3 my-2 italic text-on-background font-body-sm text-body-sm"
        >
          {renderInline(line.slice(2), `bq-${key}`)}
        </blockquote>
      );
      i++;
      continue;
    }
    if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
      blocks.push(
        <p key={key++} className="font-body-sm text-body-sm text-secondary italic mb-2">
          {renderInline(line.slice(1, -1), `note-${key}`)}
        </p>
      );
      i++;
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 my-1 space-y-1 font-body-sm text-body-sm">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `li-${key}-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    // plain paragraph
    blocks.push(
      <p key={key++} className="font-body-sm text-body-sm text-on-background mb-2">
        {renderInline(line, `p-${key}`)}
      </p>
    );
    i++;
  }

  return <div>{blocks}</div>;
}

// ── main component ───────────────────────────────────────────────────────────

export default function AgentSection({
  projectId,
  projectName,
  isChallenge = false,
}: {
  projectId: string;
  projectName: string;
  // ColaboFest projects: resources only, no checklist — a ColaboFest project
  // already comes pre-filled with SPARC's own nine readiness items, and
  // proposing six more of ours on top is what Chen called overwhelming it.
  // Resource discovery has no such conflict, so it's not withheld — only
  // this component's own description text changes; the actual suppression
  // happens server-side (the backend never runs the checklist step, and
  // never sends checklist copy for a challenge project's summary line).
  isChallenge?: boolean;
}) {
  const router = useRouter();

  // ── agent state ──
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

  // FILENAME: {project-slug}-digest-{YYYY-MM-DD}.md — sorts chronologically
  // within a project's own downloads folder (same project, several runs,
  // several dates) and reads as one phrase, e.g.
  // "atxn2-lowering-in-als-digest-2026-08-17.md".
  const downloadDigest = () => {
    if (!result?.digest) return;
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${slugify(projectName)}-digest-${date}.md`;
    const blob = new Blob([result.digest.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
            Searches across all our sources, judges what&apos;s relevant to this project&apos;s
            goal, and produces a downloadable digest of what&apos;s already been tried
            {isChallenge
              ? " plus resources to review."
              : " plus resources and checklist items to review."}
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

      {/* Rendered independent of analysis_failed below — the digest never
          calls an LLM, so a relevance-pass failure doesn't make it
          untrustworthy. It's what a click on "Run agent" is guaranteed to
          produce even on the one run in a hundred where the proposals can't
          be judged this time. */}
      {result && result.digest && (
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="font-label-lg text-label-lg text-on-background">Prior-art digest</h3>
            <button
              type="button"
              onClick={downloadDigest}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-outline-variant/50 text-on-background font-label-sm text-label-sm hover:bg-surface-container-low transition-colors shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Download .md
            </button>
          </div>
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest px-5 py-4 max-h-[70vh] overflow-y-auto">
            <MarkdownView markdown={result.digest.markdown} />
          </div>
        </div>
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
