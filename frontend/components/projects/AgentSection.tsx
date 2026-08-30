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
// This component NEVER persists anything on its own — every write for the
// proposed resources/checklist goes through the same saveToProjectAction/
// addChecklistItemAction Server Actions the Resources and Checklist
// sections already use, and only once the user hits Accept. The DIGEST is
// the one exception, and it's saved server-side, not by this component:
// app/api/project-agent/status/route.ts persists it the moment a run comes
// back done (see 2026-08-19_project_digests.sql) — this component only
// ever reads it back, via the `storedDigest` prop (the page's own
// getProject() read) on load, or via a fresh `result.digest` after a live
// run. One row per project, replaced on each run, never a history.
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
import { submitFeedbackAction } from "@/app/feedback/actions";
import type { ExploreItem } from "@/types/explore";

type ProposedItem = ExploreItem & { reason: string };
type ProposedChecklistItem = { label: string; rationale: string };

type Digest = {
  markdown: string;
  generated_at: string;
  counts: Record<string, number>;
  goal_text?: string;
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
  // Every DISTINCT item the search actually turned up, BEFORE the
  // already-saved exclusion and before the MAX_CANDIDATES cap (see
  // _flatten_candidates' total_found in tools/project_agent.py).
  // selected_items is capped at 8 by design — this is what backs "Showing
  // 8 of 47 found" below, instead of leaving the rest of what was found
  // implicit in a sources table with nothing beneath it.
  candidates_found?: number;
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
// A single failed /status request (dropped connection between browser and
// Vercel, a blip mid-run) must not abandon a job that's still running fine
// server-side — new users are the most exposed to this because a cold cache
// means a longer run and more polls, so more chances to hit one flaky
// request. Tolerate a short run of consecutive failures before giving up:
// 4 in a row (~6s at POLL_MS=1500) is long enough to ride out a single blip
// or two without masking a genuinely dead job for too long. Independently,
// cap the whole run at 3 minutes — a run that "usually takes 20-40 seconds"
// but is allowed to run much longer on a cold cache should still surface an
// error eventually rather than spin forever if the backend job itself is
// stuck, not just unreachable.
const MAX_CONSECUTIVE_POLL_FAILURES = 4;
const MAX_POLL_MS = 3 * 60 * 1000;

// ── run feedback (Accept/Discard capture) ─────────────────────────────────
//
// THE MOMENT: not when the run finishes — the researcher hasn't read it yet.
// Accept and Discard are the moments a judgement has actually been formed,
// and neither needs a timer to know when to ask.
//
// THE BEHAVIOUR IS NOT OPTIONAL, THE OPINION IS: every Accept and every
// Discard writes one row — action, run_id, and how much of what was offered
// was actually kept — whether or not the researcher taps anything.
// selected_count vs total_offered is itself a signal (2 of 8 kept reads
// differently from 8 of 8, thumbs or no thumbs), so it's captured
// unconditionally, with verdict/message left null. Tapping a verdict
// afterward, and optionally adding a sentence, appends a SECOND row against
// the same run_id rather than mutating the first — `feedback` is
// insert-only (no UPDATE policy, no SELECT policy — see
// database/migrations/2026-07-29_feedback.sql), so "add more detail later"
// is naturally another append, not an edit. A reader groups by run_id in
// SQL to see both.
type RunFeedbackCtx = {
  runId: string;
  action: "accept" | "discard";
  selectedCount: number;
  totalOffered: number;
};

function agentRunContext(ctx: RunFeedbackCtx, project: { id: string; name: string }, query: string | null) {
  return {
    kind: "agent_run",
    action: ctx.action,
    run_id: ctx.runId,
    project_id: project.id,
    project_name: project.name,
    query,
    selected_count: ctx.selectedCount,
    total_offered: ctx.totalOffered,
  };
}

// "Not useful" and "useful" ask different questions on purpose — "want to
// say why?" gets nothing a researcher hasn't already said with their tap.
// Asking what they were hoping for (miss) vs. what it missed (gap) gets an
// answer worth reading, and both stay one optional line.
const VERDICT_FOLLOWUP: Record<"useful" | "not_useful", string> = {
  useful: "Anything it missed?",
  not_useful: "What were you hoping it would find?",
};

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
  storedDigest = null,
  exploreHref,
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
  // The persisted digest from a PRIOR run (getProject()'s own read of
  // project_digests — see lib/server/projects.ts), shown collapsed on page
  // load. null when the agent has never been run for this project, or its
  // last run never produced/saved one. A fresh `result.digest` from a LIVE
  // run in this session always takes over the display — see the render
  // logic below (`!result && storedDigest`).
  storedDigest?: Digest | null;
  // "Explore for this project" — where "Showing 8 of 47 found" links, so a
  // capped-by-design proposal doesn't read as "this is all there is."
  exploreHref: string;
}) {
  const router = useRouter();

  // ── agent state ──
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<Stage>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [result, setResult] = useState<AgentResult | null>(null);
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
  const [selectedChecklistLabels, setSelectedChecklistLabels] = useState<Set<string>>(new Set());

  // Collapsed by default, per the spec: a 30KB document inline on a page
  // that already has six sections is clutter, not a convenience. Download
  // is the primary action; expanding to read it inline is opt-in.
  const [storedDigestExpanded, setStoredDigestExpanded] = useState(false);

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptedSummary, setAcceptedSummary] = useState<string | null>(null);

  // The backend-minted job_id for the run currently in `result` — this IS
  // the run_id in every feedback row below, and what keeps a second render
  // of the same run from asking for an opinion twice (see runFeedback's
  // own comment).
  const [jobId, setJobId] = useState<string | null>(null);

  // Set the instant Accept or Discard fires (see agentRunContext above) and
  // kept around independent of `result`/`acceptedSummary` clearing, so the
  // optional verdict prompt can render in the same spot regardless of
  // which outcome closed the panel. `verdict`/`opinionSent` are this run's
  // own tap state — reset to null/false every time a NEW run's Accept or
  // Discard sets `runFeedback`, so the prompt is live exactly once per run.
  const [runFeedback, setRunFeedback] = useState<RunFeedbackCtx | null>(null);
  const [verdict, setVerdict] = useState<"useful" | "not_useful" | null>(null);
  const [followupMessage, setFollowupMessage] = useState("");
  // Tap and sentence are tracked separately: `opinionSent` flips true the
  // instant a verdict is tapped (that row already went out with message:
  // null — see sendOpinion), independent of whether a follow-up sentence
  // is ever typed. `messageSent` gates the text box's own visibility so it
  // disappears once the optional sentence has actually been sent, not the
  // moment the tap alone lands.
  const [opinionSent, setOpinionSent] = useState(false);
  const [messageSent, setMessageSent] = useState(false);

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
    // A fresh run means a fresh run_id — clear any leftover feedback UI
    // from the previous run rather than let it linger under a new result.
    setJobId(null);
    setRunFeedback(null);
    setVerdict(null);
    setFollowupMessage("");
    setOpinionSent(false);

    let startedJobId: string | null = null;
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
      startedJobId = data.job_id as string;
      setJobId(startedJobId);
    } catch (e) {
      setRunning(false);
      setStage(null);
      setStartError(e instanceof Error ? e.message : "Couldn't start the agent.");
      return;
    }

    const pollStartedAt = Date.now();
    let consecutiveFailures = 0;

    pollRef.current = setInterval(async () => {
      try {
        // project_id rides along so the status route can persist the
        // digest server-side the moment this run comes back done — see
        // that route's own comment. It plays no role in reading progress;
        // membership for the SAVE is enforced by RLS on that route's write,
        // not by anything checked here.
        const res = await fetch(
          `/api/project-agent/status?job_id=${encodeURIComponent(startedJobId!)}&project_id=${encodeURIComponent(projectId)}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lost track of the agent's progress.");

        // A poll that reached the server and got a real answer clears any
        // error left over from prior failed polls in THIS run — the run is
        // healthy again, and an error should only ever describe the
        // current state, not a blip that already recovered.
        consecutiveFailures = 0;
        setStartError(null);

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
        consecutiveFailures += 1;
        const timedOut = Date.now() - pollStartedAt > MAX_POLL_MS;
        // Keep polling through transient failures — the job is very likely
        // still running server-side (see module docstring: server logs show
        // 200s the whole time on the run that showed this error). Only give
        // up after several failures in a row, or an overall timeout.
        if (consecutiveFailures < MAX_CONSECUTIVE_POLL_FAILURES && !timedOut) return;

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
  // "atxn2-lowering-in-als-digest-2026-08-17.md". Dated from the digest's
  // OWN generated_at when downloading a stored one (accurate for a digest
  // from a prior session), falling back to today for a fresh live result
  // (generated_at and "now" are the same moment there anyway).
  const downloadDigest = (digest: Digest) => {
    const date = (digest.generated_at || new Date().toISOString()).slice(0, 10);
    const filename = `${slugify(projectName)}-digest-${date}.md`;
    const blob = new Blob([digest.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // "Aug 19, 2026" — same shape as everywhere else in this app that dates a
  // moment for a human, not a machine.
  const formatDigestDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
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

  // Fires the UNCONDITIONAL behavioural row (see the module-level comment
  // above RunFeedbackCtx) and arms the optional verdict prompt for this run.
  // Never awaited by the caller — this must never slow down or fail the
  // actual Accept/Discard it's observing (same "never throws to the user"
  // stance submitFeedback itself already guarantees, belt-and-suspenders
  // here with its own try/catch since this fires fire-and-forget).
  const recordRunFeedback = (action: "accept" | "discard", selectedCount: number, totalOffered: number) => {
    if (!jobId) return; // no run to attribute this to (shouldn't happen — accept/discard require `result`)
    const ctx: RunFeedbackCtx = { runId: jobId, action, selectedCount, totalOffered };
    setRunFeedback(ctx);
    setVerdict(null);
    setFollowupMessage("");
    setOpinionSent(false);
    setMessageSent(false);
    try {
      submitFeedbackAction({
        page_path: `/projects/${projectId}`,
        message: null,
        context: agentRunContext(ctx, { id: projectId, name: projectName }, result?.digest?.goal_text ?? null),
      });
    } catch {
      // best-effort — see comment above
    }
  };

  // Tapping a verdict (optionally followed by typing the one-liner and
  // pressing Send) appends a SECOND row against the same run_id — see the
  // module comment on RunFeedbackCtx for why this is a second insert, not
  // an update. Safe to call again after typing more, since `feedback` is
  // insert-only regardless; opinionSent only gates the UI, not the table.
  const sendOpinion = (v: "useful" | "not_useful", message: string | null) => {
    if (!runFeedback) return;
    setVerdict(v);
    setOpinionSent(true);
    if (message) setMessageSent(true);
    try {
      submitFeedbackAction({
        page_path: `/projects/${projectId}`,
        message,
        context: {
          ...agentRunContext(runFeedback, { id: projectId, name: projectName }, result?.digest?.goal_text ?? null),
          verdict: v,
        },
      });
    } catch {
      // best-effort — see recordRunFeedback
    }
  };

  const discard = () => {
    recordRunFeedback("discard", 0, result ? result.selected_items.length + result.checklist_items.length : 0);
    setResult(null);
    setAcceptError(null);
  };

  const accept = async () => {
    if (!result || accepting) return;
    setAccepting(true);
    setAcceptError(null);

    const itemsToSave = result.selected_items.filter((i) => selectedResourceIds.has(i.id));
    const checklistToAdd = result.checklist_items.filter((c) => selectedChecklistLabels.has(c.label));

    recordRunFeedback(
      "accept",
      itemsToSave.length + checklistToAdd.length,
      result.selected_items.length + result.checklist_items.length
    );

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

      {/* STORED digest from a prior run (getProject()'s own read, saved
          server-side by app/api/project-agent/status/route.ts) — shown
          collapsed by default with Download as the PRIMARY action, per the
          spec: 30KB inline on a page with six sections already is clutter,
          not a convenience. Superseded the instant a LIVE run produces its
          own `result.digest` below — "running the agent again replaces
          it," both in storage and on screen. */}
      {!result && storedDigest && (
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h3 className="font-label-lg text-label-lg text-on-background">Prior-art digest</h3>
              <p className="font-body-sm text-body-sm text-secondary mt-0.5">
                Generated {formatDigestDate(storedDigest.generated_at)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadDigest(storedDigest)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download .md
              </button>
              <button
                type="button"
                onClick={() => setStoredDigestExpanded((v) => !v)}
                aria-expanded={storedDigestExpanded}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-outline-variant/50 text-on-background font-label-sm text-label-sm hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {storedDigestExpanded ? "expand_less" : "expand_more"}
                </span>
                {storedDigestExpanded ? "Hide" : "View"}
              </button>
            </div>
          </div>
          {storedDigestExpanded && (
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest px-5 py-4 max-h-[70vh] overflow-y-auto">
              <MarkdownView markdown={storedDigest.markdown} />
            </div>
          )}
        </div>
      )}

      {/* LIVE digest from THIS session's run — always shown expanded (a
          researcher who just clicked "Run agent" wants to see what they
          got), unlike the collapsed stored card above. Rendered independent
          of analysis_failed below — the digest never calls an LLM, so a
          relevance-pass failure doesn't make it untrustworthy. It's what a
          click on "Run agent" is guaranteed to produce even on the one run
          in a hundred where the proposals can't be judged this time. */}
      {result && result.digest && (
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="font-label-lg text-label-lg text-on-background">Prior-art digest</h3>
            <button
              type="button"
              onClick={() => downloadDigest(result.digest!)}
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

      {/* RUN FEEDBACK — the optional half. The behavioural row (action +
          counts) already fired unconditionally, inside discard()/accept()
          itself, the instant either was clicked — see recordRunFeedback.
          This widget only ever captures the OPINION on top of that.
          Rendered exactly where the review panel (below) sat before
          Accept/Discard cleared `result` — the panel closes and this takes
          its place in the same spot, not blocking, not a modal, so their
          eye is already there instead of on a popup. */}
      {!result && runFeedback && (
        <div className="glass-card rounded-2xl p-6 flex flex-wrap items-center gap-3 font-body-sm text-body-sm text-secondary">
          {!verdict ? (
            <>
              <span>Was this useful?</span>
              <button
                type="button"
                onClick={() => sendOpinion("useful", null)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-outline-variant/50 hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">thumb_up</span>
                Useful
              </button>
              <button
                type="button"
                onClick={() => sendOpinion("not_useful", null)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-outline-variant/50 hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">thumb_down</span>
                Not useful
              </button>
            </>
          ) : (
            <div className="w-full max-w-xl space-y-2">
              <p className="font-body-sm text-body-sm text-secondary">Thanks — that helps.</p>
              {!messageSent && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={followupMessage}
                    onChange={(e) => setFollowupMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && followupMessage.trim()) {
                        sendOpinion(verdict, followupMessage.trim());
                      }
                    }}
                    placeholder={VERDICT_FOLLOWUP[verdict]}
                    className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2 font-body-sm text-body-sm text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    disabled={!followupMessage.trim()}
                    onClick={() => sendOpinion(verdict, followupMessage.trim())}
                    className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          )}
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

          {/* The agent proposes a CAPPED, curated subset by design (8 of
              however many the search actually found) — without this line a
              user just sees a sources table saying e.g. "10 datasets" and
              nothing beneath it, reading as if the rest was silently
              dropped rather than deliberately not shown here. Only rendered
              when there's genuinely more than what's proposed. */}
          {typeof result.candidates_found === "number" &&
            result.candidates_found > result.selected_items.length && (
              <p className="font-body-sm text-body-sm text-secondary mb-4">
                Showing {result.selected_items.length} of {result.candidates_found} found —{" "}
                <a href={exploreHref} className="text-primary hover:underline">
                  browse everything
                </a>
                .
              </p>
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
