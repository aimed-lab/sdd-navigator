"use client";

// WikiGraph — the project wiki's graph view (stage 2). Force-directed,
// d3-force (already a dependency — "d3": "^7.9.0" in package.json — but
// unused anywhere in this app until now; there is no existing d3 idiom to
// match here, so this picks the standard React+d3-force pairing: d3 owns
// the simulation math only, React owns every DOM node via normal JSX/SVG,
// nothing touches the DOM through a d3 selection. HAND-ROLLED SVG
// rendering, not a graph library (react-force-graph, cytoscape, etc.) —
// at the scale this ever needs to render (a handful of notes, not
// thousands), d3-force plus plain SVG is maybe 150 lines and avoids a new
// dependency plus that dependency's own theming/sizing fights.
//
// NODES ARE NOTES, NEVER EVIDENCE ITEMS — per this stage's own design
// constraint ("56 papers as nodes would drown 7 concepts"). An item is
// never drawn as a node; it only ever appears inside a note's side panel,
// grouped by kind.
//
// GHOST NODES: a [[Link]] some note's body names that matches no real note
// — rendered dashed, unfilled, no evidence panel content beyond "no note
// exists for this yet" and which real note(s) reference it. This is a
// signal (the agent flagged something worth a note, found nothing to write
// yet), not a broken link, so it's drawn as a first-class node, not hidden
// or logged only to the console.
//
// NO NEW CARD SHAPE for evidence-by-kind: EvidenceRow below reuses the
// same accent-bar-plus-pill idiom ItemCard.tsx already uses across the app
// (its own ACCENT map, duplicated here as a small constant — see that
// file — because ACCENT isn't exported and a curated evidence row doesn't
// carry the full Item shape ItemCard's props require: raw, dedupe_key,
// signal as a nested object, etc.).

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import * as d3 from "d3-force";
import type {
  EvidenceItemRow,
  MissingNoteSuggestion,
  WikiGraphGhostLink,
  WikiGraphNote,
} from "@/lib/server/wikiEvidence";
import { editNoteAction } from "@/app/projects/[id]/wiki/actions";

// Duplicated from components/ItemCard.tsx's own (unexported) ACCENT map —
// see this file's header comment for why it isn't imported directly.
const KIND_ACCENT: Record<string, string> = {
  paper: "border-l-primary",
  news: "border-l-sky-500",
  tool: "border-l-blue-500",
  trial: "border-l-purple-500",
  grant: "border-l-amber-500",
  dataset: "border-l-emerald-500",
  geneset: "border-l-fuchsia-500",
  compound: "border-l-rose-500",
  target: "border-l-indigo-500",
  episode: "border-l-primary-container",
  resource: "border-l-teal-500",
  person: "border-l-secondary",
};

const NOTE_TYPE_COLOR: Record<string, { fill: string; label: string }> = {
  concept: { fill: "#6366f1", label: "Concept" }, // indigo-500
  entity: { fill: "#10b981", label: "Entity" }, // emerald-500
  question: { fill: "#f59e0b", label: "Open question" }, // amber-500
};

const GHOST_FILL = "none";
const GHOST_STROKE = "#94a3b8"; // slate-400
const LINK_RE = /\[\[([^\]]+)\]\]/g;

function normalizeTitle(title: string): string {
  return title
    .replace(/[‐-―]/g, "-")
    .replace(/[\s-]+/g, " ")
    .trim()
    .toLowerCase();
}

type GraphNode = d3.SimulationNodeDatum & {
  id: string;
  kind: "note" | "ghost";
  title: string;
  noteType?: "concept" | "entity" | "question";
  evidenceCount: number;
  radius: number;
  note?: WikiGraphNote;
  ghost?: WikiGraphGhostLink;
};

type GraphLink = { source: string; target: string };

function buildGraph(notes: WikiGraphNote[], ghostLinks: WikiGraphGhostLink[]) {
  const nodes: GraphNode[] = [];
  const byNormalizedTitle = new Map<string, string>(); // normalized title -> node id

  for (const note of notes) {
    const radius = 22 + Math.sqrt(note.evidence.length) * 7;
    nodes.push({
      id: note.id,
      kind: "note",
      title: note.title,
      noteType: note.note_type,
      evidenceCount: note.evidence.length,
      radius,
      note,
    });
    byNormalizedTitle.set(normalizeTitle(note.title), note.id);
  }
  for (const ghost of ghostLinks) {
    const id = `ghost:${normalizeTitle(ghost.title)}`;
    nodes.push({
      id,
      kind: "ghost",
      title: ghost.title,
      evidenceCount: 0,
      radius: 16,
      ghost,
    });
  }

  const links: GraphLink[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    for (const match of note.body.matchAll(LINK_RE)) {
      const key = normalizeTitle(match[1].trim());
      const targetId = byNormalizedTitle.get(key) ?? `ghost:${key}`;
      if (targetId === note.id) continue; // a note linking to itself draws nothing
      const linkKey = [note.id, targetId].sort().join("::");
      if (seen.has(linkKey)) continue;
      seen.add(linkKey);
      links.push({ source: note.id, target: targetId });
    }
  }
  return { nodes, links };
}

const WIDTH = 900;
const HEIGHT = 560;

export default function WikiGraph({
  projectId,
  notes,
  unfiled,
  projectLevel,
  ghostLinks,
  missingNoteSuggestions,
}: {
  projectId: string;
  notes: WikiGraphNote[];
  unfiled: EvidenceItemRow[];
  projectLevel: EvidenceItemRow[];
  ghostLinks: WikiGraphGhostLink[];
  missingNoteSuggestions: MissingNoteSuggestion[];
}) {
  const { nodes: initialNodes, links } = useMemo(() => buildGraph(notes, ghostLinks), [notes, ghostLinks]);
  const [positions, setPositions] = useState<GraphNode[]>(initialNodes);
  const [selected, setSelected] = useState<{ type: "note" | "ghost" | "unfiled" | "projectLevel"; id: string } | null>(
    null
  );
  const simRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null);

  useEffect(() => {
    const sim = d3
      .forceSimulation<GraphNode>(initialNodes.map((n) => ({ ...n })))
      .force(
        "link",
        d3
          .forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(
            links.map((l) => ({ source: l.source, target: l.target }))
          )
          .id((d) => d.id)
          .distance(140)
          .strength(0.5)
      )
      .force("charge", d3.forceManyBody().strength(-320))
      .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
      .force(
        "collide",
        d3.forceCollide<GraphNode>().radius((d) => d.radius + 14)
      )
      .on("tick", () => {
        // Clamp every node inside the SVG's own viewBox. Without this, the
        // charge force can push a node past the WIDTH/HEIGHT bounds on a
        // small graph (confirmed visually: a node drifting to y < radius
        // gets its top sliced off by the SVG's own edge, rendering as a
        // flat-topped "coin" instead of a circle) — forceCenter only pulls
        // toward the middle on average, it doesn't bound any single node.
        for (const n of sim.nodes()) {
          n.x = Math.max(n.radius, Math.min(WIDTH - n.radius, n.x ?? WIDTH / 2));
          n.y = Math.max(n.radius, Math.min(HEIGHT - n.radius, n.y ?? HEIGHT / 2));
        }
        setPositions(sim.nodes().map((n) => ({ ...n })));
      });
    simRef.current = sim;
    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNodes, links]);

  const resolvedLinks = useMemo(() => {
    const byId = new Map(positions.map((n) => [n.id, n]));
    return links
      .map((l) => ({ a: byId.get(l.source), b: byId.get(l.target) }))
      .filter((l): l is { a: GraphNode; b: GraphNode } => !!l.a && !!l.b);
  }, [links, positions]);

  const selectedNote = selected?.type === "note" ? notes.find((n) => n.id === selected.id) ?? null : null;
  const selectedGhost =
    selected?.type === "ghost" ? ghostLinks.find((g) => `ghost:${normalizeTitle(g.title)}` === selected.id) ?? null : null;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="glass-card rounded-2xl p-4 flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2 px-2">
          <div className="flex items-center gap-4 font-label-sm text-label-sm text-secondary">
            {Object.entries(NOTE_TYPE_COLOR).map(([type, { fill, label }]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: fill }} />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full border border-dashed"
                style={{ borderColor: GHOST_STROKE }}
              />
              Ghost (no note yet)
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Grants/trials that matched no note are evidence FOR THE
                PROJECT, not a "maybe a note is missing" signal — kept out
                of the unfiled count and given their own button rather than
                silently counted as unfiled noise. See wikiEvidence.ts's
                splitUnfiled(). */}
            {projectLevel.length > 0 && (
              <button
                type="button"
                onClick={() => setSelected({ type: "projectLevel", id: "projectLevel" })}
                className="font-label-sm text-label-sm px-3 py-1.5 rounded-full bg-surface-container-low hover:bg-surface-container transition-colors"
              >
                {projectLevel.length} supporting the project
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected({ type: "unfiled", id: "unfiled" })}
              className="font-label-sm text-label-sm px-3 py-1.5 rounded-full bg-surface-container-low hover:bg-surface-container transition-colors"
            >
              {unfiled.length} unfiled item{unfiled.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto"
          role="img"
          aria-label="Project wiki graph"
        >
          <g>
            {resolvedLinks.map((l, i) => (
              <line
                key={i}
                x1={l.a.x}
                y1={l.a.y}
                x2={l.b.x}
                y2={l.b.y}
                stroke={l.a.kind === "ghost" || l.b.kind === "ghost" ? GHOST_STROKE : "#cbd5e1"}
                strokeDasharray={l.a.kind === "ghost" || l.b.kind === "ghost" ? "4 4" : undefined}
                strokeWidth={1.5}
              />
            ))}
          </g>
          <g>
            {positions.map((n) => {
              const isGhost = n.kind === "ghost";
              const color = isGhost ? undefined : NOTE_TYPE_COLOR[n.noteType ?? "concept"]?.fill;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                  onClick={() => setSelected({ type: isGhost ? "ghost" : "note", id: n.id })}
                  className="cursor-pointer"
                >
                  <circle
                    r={n.radius}
                    fill={isGhost ? GHOST_FILL : color}
                    stroke={isGhost ? GHOST_STROKE : selected?.id === n.id ? "#0f172a" : "none"}
                    strokeWidth={selected?.id === n.id ? 3 : isGhost ? 2 : 0}
                    strokeDasharray={isGhost ? "5 4" : undefined}
                    opacity={isGhost ? 0.6 : 0.92}
                  />
                  <text
                    textAnchor="middle"
                    dy={n.radius + 16}
                    className="font-label-sm select-none pointer-events-none"
                    style={{ fontSize: 11, fill: "var(--color-on-background, #1f2937)" }}
                  >
                    {n.title.length > 34 ? `${n.title.slice(0, 34)}…` : n.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {missingNoteSuggestions.length > 0 && (
          <div className="mt-2 px-2 py-3 border-t border-outline-variant/30">
            <p className="font-label-sm text-label-sm text-secondary mb-1">
              Unfiled items keep mentioning:
            </p>
            <div className="flex flex-wrap gap-2">
              {missingNoteSuggestions.map((s) => (
                <span
                  key={s.term}
                  className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-700 font-label-sm text-label-sm"
                  title={`${s.count} unfiled items mention "${s.term}" — possibly a missing note.`}
                >
                  {s.term} ({s.count})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <SidePanel
          projectId={projectId}
          note={selectedNote}
          ghost={selectedGhost}
          unfiled={selected.type === "unfiled" ? unfiled : null}
          projectLevel={selected.type === "projectLevel" ? projectLevel : null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function EvidenceRow({ item }: { item: EvidenceItemRow }) {
  const accent = KIND_ACCENT[item.kind] ?? "border-l-outline-variant";
  return (
    <div className={`border-l-4 ${accent} bg-surface-container-lowest rounded-r-lg px-3 py-2`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="px-2 py-0.5 rounded-full bg-surface-container text-secondary font-label-sm text-label-sm">
          {item.kind}
        </span>
        {item.source && (
          <span className="font-label-sm text-label-sm text-secondary">{item.source}</span>
        )}
      </div>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="font-body-sm text-body-sm text-primary hover:underline">
          {item.title}
        </a>
      ) : (
        <p className="font-body-sm text-body-sm text-on-background">{item.title}</p>
      )}
      {item.summary && <p className="font-body-sm text-body-sm text-secondary mt-1 line-clamp-2">{item.summary}</p>}
    </div>
  );
}

function groupByKind(items: EvidenceItemRow[]): [string, EvidenceItemRow[]][] {
  const groups = new Map<string, EvidenceItemRow[]>();
  for (const item of items) {
    const list = groups.get(item.kind) ?? [];
    list.push(item);
    groups.set(item.kind, list);
  }
  return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
}

function SidePanel({
  projectId,
  note,
  ghost,
  unfiled,
  projectLevel,
  onClose,
}: {
  projectId: string;
  note: WikiGraphNote | null;
  ghost: WikiGraphGhostLink | null;
  unfiled: EvidenceItemRow[] | null;
  projectLevel: EvidenceItemRow[] | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    panelRef.current?.focus();
    setDraft(note?.body ?? "");
    setEditing(false);
    setError(null);
  }, [note?.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    if (!note) return;
    startTransition(async () => {
      const result = await editNoteAction(projectId, note.id, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={note?.title ?? ghost?.title ?? (projectLevel ? "Supporting the project" : "Unfiled items")}
      className="w-full lg:w-[420px] shrink-0 glass-card rounded-2xl p-6 max-h-[80vh] overflow-y-auto outline-none"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <h2 className="font-headline-sm text-headline-sm text-on-background">
          {note?.title ?? ghost?.title ?? (projectLevel ? "Supporting the project" : "Unfiled items")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-secondary hover:text-on-background"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {note && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <span
              className="px-2 py-0.5 rounded-full font-label-sm text-label-sm text-white"
              style={{ backgroundColor: NOTE_TYPE_COLOR[note.note_type]?.fill }}
            >
              {NOTE_TYPE_COLOR[note.note_type]?.label}
            </span>
            {note.is_human_edited && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm">
                Edited by a teammate — the agent won&apos;t overwrite this
              </span>
            )}
          </div>

          {editing ? (
            <div className="mb-6">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="w-full glass-panel rounded-xl p-3 font-body-sm text-body-sm outline-none"
              />
              {error && <p className="font-body-sm text-body-sm text-error mt-1">{error}</p>}
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={save} disabled={isPending} className="btn-primary text-label-sm px-4 py-2">
                  {isPending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(note.body);
                    setError(null);
                  }}
                  className="btn-outline text-label-sm px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <p className="font-body-sm text-body-sm text-on-background whitespace-pre-wrap">
                {note.body.replace(/\[\[([^\]]+)\]\]/g, "$1")}
              </p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-2 font-label-sm text-label-sm text-primary hover:underline"
              >
                Edit
              </button>
            </div>
          )}

          <h3 className="font-label-md text-label-md text-secondary mb-2">
            Evidence ({note.evidence.length})
          </h3>
          {note.evidence.length === 0 ? (
            <p className="font-body-sm text-body-sm text-secondary">Nothing filed under this note yet.</p>
          ) : (
            <div className="space-y-4">
              {groupByKind(note.evidence).map(([kind, items]) => (
                <div key={kind}>
                  <p className="font-label-sm text-label-sm text-secondary mb-1 capitalize">
                    {kind} ({items.length})
                  </p>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <EvidenceRow key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {ghost && (
        <div>
          <p className="font-body-sm text-body-sm text-secondary mb-4">
            No note exists for this title yet — the agent flagged it as a concept worth tracking
            (via a <code>[[link]]</code>) but hasn&apos;t written anything about it. This may mean
            a future run finds evidence for it, or a teammate should look into it directly.
          </p>
          <p className="font-label-sm text-label-sm text-secondary">
            Referenced from: {ghost.referencedFrom.join(", ")}
          </p>
        </div>
      )}

      {unfiled && (
        <>
          <p className="font-body-sm text-body-sm text-secondary mb-4">
            Every item a run retrieved that didn&apos;t match any note&apos;s vocabulary closely
            enough to be filed — never dropped, just not organized under a concept yet.
          </p>
          <div className="space-y-4">
            {groupByKind(unfiled).map(([kind, items]) => (
              <div key={kind}>
                <p className="font-label-sm text-label-sm text-secondary mb-1 capitalize">
                  {kind} ({items.length})
                </p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <EvidenceRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {projectLevel && (
        <>
          <p className="font-body-sm text-body-sm text-secondary mb-4">
            Grants and trials this run found that support the project as a whole rather than any
            one concept — real evidence, just not the kind a note's own grounding gate can check
            a claim against. Never counted as unfiled.
          </p>
          <div className="space-y-4">
            {groupByKind(projectLevel).map(([kind, items]) => (
              <div key={kind}>
                <p className="font-label-sm text-label-sm text-secondary mb-1 capitalize">
                  {kind} ({items.length})
                </p>
                <div className="space-y-2">
                  {items.map((item) => (
                    <EvidenceRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
