"use client";

// Prior-art brief section — "Generate prior-art brief" button on the project
// page. Calls /api/prior-art-brief (proxies to backend/explore-mcp/tools/
// prior_art_brief.py), renders the returned Markdown, and offers it as a
// .md download. Serves ColaboFest's "Rigor and innovation — differentiation
// from existing approaches" review criterion.
//
// AVAILABLE ON EVERY PROJECT, INCLUDING COLABOFEST — unlike AgentSection
// (hidden there because it pushes proposals into a workspace that already
// has nine readiness items), this is pull-based: a member clicks, nothing is
// proposed or saved anywhere. See app/api/prior-art-brief/route.ts's own
// comment for the full reasoning, same as ProjectChatbot's.
//
// NOTHING IS PERSISTED. Regenerating replaces what's shown; closing the page
// loses it, same as the agent's own unaccepted results. It belongs in the
// project wiki once that exists — not blocked on here.
//
// MARKDOWN RENDERING: a small hand-written renderer for exactly the subset
// the backend generator emits (# / ## / ### headers, **bold**, [text](url)
// links, > blockquotes, - list items, | table |, italics *text*) rather than
// pulling in a markdown library for one document shape this codebase fully
// controls the format of.

import { useState } from "react";

type BriefResult = {
  markdown: string;
  generated_at: string;
  counts: Record<string, number>;
};

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

// ── minimal inline markdown (bold / italic / links) ──────────────────────────

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

// ── block-level renderer ──────────────────────────────────────────────────────

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

// ── main section ───────────────────────────────────────────────────────────────

export default function PriorArtBriefSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BriefResult | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/prior-art-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.markdown !== "string") {
        throw new Error(data.error || "Couldn't generate the brief right now.");
      }
      setResult(data as BriefResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the brief right now.");
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!result) return;
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${slugify(projectName)}-prior-art-brief-${date}.md`;
    const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <h2 className="font-title-md text-title-md text-on-background">Prior-art brief</h2>
          <p className="font-body-sm text-body-sm text-secondary mt-1">
            Searches papers, trials, tools, datasets and gene sets for this project&apos;s target
            and indication, and reports what was found — terminated/withdrawn trials with their
            stated stop reason, recruiting trials, and what the search didn&apos;t find. It reports
            search results; it never concludes anything is novel — that call is yours to make.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {result && (
            <button
              type="button"
              onClick={download}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-outline-variant/50 text-on-background font-label-sm text-label-sm hover:bg-surface-container-low transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Download .md
            </button>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-on-primary/40 border-t-on-primary animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">description</span>
                {result ? "Regenerate" : "Generate prior-art brief"}
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-error/30 bg-error/5 text-error px-4 py-3 font-body-sm text-body-sm mb-3">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest px-5 py-4 max-h-[70vh] overflow-y-auto">
          <MarkdownView markdown={result.markdown} />
        </div>
      )}
    </section>
  );
}
