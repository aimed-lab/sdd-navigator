"use client";

// ItemCard — the reusable result card for the whole platform (Explore, search,
// saved, etc.). Renders one backend Item: title, one-line context, and an
// evidence-backed SIGNAL BADGE only when a real metric exists. It NEVER shows a
// vague label ("recommended" etc.) — no signal falls back to the date, or nothing.
//
// PROJECT-SCOPED SAVING: pass `projectId` (from /explore/[topic] when
// arrived via a project's "Explore for this project" link, or from the
// project page's own Resources section) and the bookmark button saves
// INTO that project via app/explore/actions.ts, with an optimistic toggle
// that REVERTS and shows a visible error on failure — never a silent
// no-op. Omit `projectId` and this is byte-for-byte the original
// behavior: a bare local toggle, no network call, no persistence — that
// is deliberate, not an oversight; see app/explore/[topic]/page.tsx for
// why Explore without project context must stay exactly as it was.

import { useState } from "react";
import type {
  ChemblRaw,
  ExploreItem,
  OpenTargetsRaw,
  OpenTargetsTractability,
  TrialRaw,
} from "@/types/explore";
import { removeFromProjectAction, saveToProjectAction } from "@/app/explore/actions";

// Per-kind top-border accent (literal class strings so Tailwind compiles them).
const ACCENT: Record<string, string> = {
  paper: "border-t-primary",
  news: "border-t-sky-500",
  tool: "border-t-blue-500",
  trial: "border-t-purple-500",
  grant: "border-t-amber-500",
  dataset: "border-t-emerald-500",
  geneset: "border-t-fuchsia-500",
  // rose-500 — unused by every other kind (paper=primary, news=sky,
  // tool=blue, trial=purple, grant=amber, dataset=emerald, geneset=fuchsia,
  // episode=primary-container, resource=teal, person=secondary, target=indigo).
  compound: "border-t-rose-500",
  // indigo-500 — unused by every other kind (see the rose-500 comment above
  // for the full accounting; indigo isn't in that list either).
  target: "border-t-indigo-500",
  episode: "border-t-primary-container",
  resource: "border-t-teal-500",
  person: "border-t-secondary",
};

// GEO dataset fields (backend/explore-mcp/sources/geo.py) — all in `raw`,
// there is no top-level Item field for any of them except date_iso/url.
type GeoRaw = {
  accession?: string;
  organism?: string | null;
  sample_count?: number | null;
  experiment_type?: string | null;
  platform?: string | null;
};

function geoFields(item: ExploreItem): GeoRaw | null {
  if (item.kind !== "dataset") return null;
  return (item.raw ?? {}) as GeoRaw;
}

// PAGER gene-set fields (backend/explore-mcp/sources/pager.py) — all in
// `raw`, no top-level Item field for any of them. No WINNER badge here:
// signal is always null for this kind (gene sets have no citation graph),
// so signalBadge() falls through to the plain date badge automatically —
// same "no fabricated ranking" idiom as GEO datasets above.
type GenesetRaw = {
  type_label?: string;
  source?: string | null;
  size?: number;
  ncoco_score?: number;
};

function genesetFields(item: ExploreItem): GenesetRaw | null {
  if (item.kind !== "geneset") return null;
  return (item.raw ?? {}) as GenesetRaw;
}

// Clinical-trial fields (backend/explore-mcp/sources/clinical_trials.py) — all
// in `raw`. `why_stopped` MUST be rendered EXACTLY as returned: it is quoted
// verbatim from ClinicalTrials.gov's own record, straight through fetch_trials
// -> response.py's trim (clinicaltrials is in _INTERNAL_SOURCES, untouched) ->
// here. Nothing in this component (or anywhere else in this file) runs it
// through an LLM/summarization step, and it must stay that way — a
// paraphrased "why a trial stopped" is not a fact a reader can rely on.
function trialFields(item: ExploreItem): TrialRaw | null {
  if (item.kind !== "trial") return null;
  return (item.raw ?? {}) as TrialRaw;
}

// ChEMBL compound fields (backend/explore-mcp/sources/chembl.py) — all in
// `raw`, no top-level Item field for any of them. Two record shapes share
// this kind (see that module's docstring): a mechanism-of-action record
// (mechanism_of_action/max_phase/action_type/mutation populated) or a
// bioactivity record (pchembl_value/standard_type/standard_value/
// standard_units populated) — never both on the same item, so the card
// renders whichever fields are actually present. No WINNER badge here either:
// signal is always null (no citation graph between compounds), same
// "no fabricated ranking" idiom as GEO/PAGER above.
//
// `item.title` is already the resolved drug name (pref_name) when ChEMBL has
// one, falling back to the bare molecule_chembl_id when it doesn't — the
// backend bakes that fallback in, never a fabricated name. The id itself is
// never dropped even when a name resolves: raw.molecule_chembl_id is always
// rendered below as canonical secondary text, same as a trial card's phase/
// status line next to its title.
function chemblFields(item: ExploreItem): ChemblRaw | null {
  if (item.kind !== "compound") return null;
  return (item.raw ?? {}) as ChemblRaw;
}

// Open Targets target-disease evidence fields (backend/explore-mcp/sources/
// opentargets.py) — all in `raw`, no top-level Item field for any of them.
// One target-disease association per item (not a nested list) — see that
// module's docstring for why one card per association reads better than a
// mega-card. No WINNER badge here either: signal is always null (an
// association score is not a citation/star count), same "no fabricated
// ranking" idiom as GEO/PAGER/ChEMBL above.
function opentargetsFields(item: ExploreItem): OpenTargetsRaw | null {
  if (item.kind !== "target") return null;
  return (item.raw ?? {}) as OpenTargetsRaw;
}

// Evidence-type label -> a short, readable display string. Open Targets'
// own datatype ids are snake_case internal names (genetic_association,
// known_drug, ...) — title-cased with underscores replaced, not relabeled
// into different vocabulary, so the string a reader sees is still
// recognizably the same field Open Targets reports.
function evidenceLabel(type: string | undefined): string {
  if (!type) return "evidence";
  return type
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Open Targets modality codes (SM/AB/PR/OC), spelled out in plain words for
// a card — see sources/opentargets.py's _curated_tractability for what's
// already been filtered out (PR-modality data-availability noise like
// "Half-life Data") before this ever reaches the frontend.
const MODALITY_LABEL: Record<string, string> = {
  SM: "small molecule",
  AB: "antibody",
  PR: "PROTAC",
  OC: "other modality",
};

function modalityLabel(modality: string | undefined): string {
  if (!modality) return "unknown modality";
  return MODALITY_LABEL[modality] ?? modality;
}

/** One or two plain-language tractability facts from the curated
 *  {label, modality, value} list — never the raw SM/AB/PR codes or a
 *  9-line flag dump. See ItemCard's target render block. */
function tractabilitySummary(rows: OpenTargetsTractability[] | undefined): string | null {
  if (!rows || rows.length === 0) return null;
  const hasApprovedDrug = rows.some((r) => r.label === "Approved Drug");
  const modalities = Array.from(new Set(rows.map((r) => modalityLabel(r.modality))));
  const parts: string[] = [];
  if (hasApprovedDrug) parts.push("approved drug available");
  if (modalities.length > 0) parts.push(`tractable: ${modalities.join(", ")}`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n)}`;
}

function citationText(value: number): string | null {
  const n = Math.round(value);
  return n > 0 ? `${n.toLocaleString()} citation${n === 1 ? "" : "s"}` : null;
}

// The citation count the backend preserved when it replaced the signal with a
// network_rank one (ranking.py stashes the displaced metric in raw.prior_signal).
function priorCitations(item: ExploreItem): string | null {
  const prior = item.raw?.prior_signal as { metric?: string; value?: number } | undefined;
  if (!prior || prior.metric !== "citations" || typeof prior.value !== "number") return null;
  return citationText(prior.value);
}

// A real, evidence-backed badge string, or null if the signal isn't meaningful.
// citations only when > 0 (a page of 0-citation preprints shouldn't all read
// "0 citations" — fall back to the date instead); stars always (GitHub filters >=5).
//
// `variant` distinguishes which of the two paper subsections a card is being
// rendered in (see app/explore/page.tsx / [topic]/page.tsx: "Latest Papers"
// vs the WINNER-reordered "Key Papers" subsection below it). Both subsection
// headers already say what they are, so neither card repeats a "★ Key paper"
// label — that reads as redundant next to a header that already says
// "Key Papers", and was inconsistent on Latest Papers cards anyway (it only
// fired when raw.prior_signal happened to be present from a WINNER re-rank,
// which predates the Latest/Key split — some Latest Papers cards had it and
// some didn't, for no reason visible to a reader). The citation COUNT itself
// is preserved and shown in both subsections; only the star/label text
// changes based on where the card lives.
function signalBadge(item: ExploreItem, variant: "default" | "key" = "default"): string | null {
  const signal = item.signal;
  if (!signal) return null;

  // WINNER network centrality. The raw score is an internal graph quantity with
  // no meaning to a reader ("3.00" says nothing), so it is NEVER shown — the
  // label is qualitative and is backed by the real, preserved citation count.
  if (signal.metric === "network_rank") {
    // Neither subsection shows the "★ Key paper" star/label anymore: the
    // Key Papers header already says it, and on Latest Papers it fired
    // inconsistently (only when raw.prior_signal happened to survive a
    // WINNER re-rank) and read as confusing next to cards without it. Only
    // the real citation count — never the label — is preserved, identically
    // for both `variant`s (kept as an explicit prop for callers/future
    // per-subsection divergence, not because the two currently differ).
    return priorCitations(item);
  }

  if (signal.metric === "citations") return citationText(signal.value);
  if (signal.metric === "stars") return `★ ${compact(signal.value)} stars`;
  return signal.value > 0 ? `${compact(signal.value)} ${signal.metric}` : null;
}

// Trial status pill tokens — RECRUITING and TERMINATED/WITHDRAWN previously
// rendered in the same purple-500, so a stopped programme visually read as
// live. All three states use tokens already in the design system (no new
// colors): RECRUITING gets the same primary/10-on-primary "live/positive"
// treatment as CommunityPanel's "Member" badge; TERMINATED/WITHDRAWN/
// SUSPENDED get the error-container pair used everywhere else a stopped/
// failed state is shown; anything else (COMPLETED, ACTIVE_NOT_RECRUITING,
// etc.) falls back to the neutral surface-container-low/secondary pairing
// used for the plain date badge below.
function trialStatusClasses(status: string): string {
  if (status === "RECRUITING") return "bg-primary/10 text-primary";
  if (status === "TERMINATED" || status === "WITHDRAWN" || status === "SUSPENDED") {
    return "bg-error-container text-on-error-container";
  }
  return "bg-surface-container-low text-secondary";
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return null; // epoch/placeholder -> nothing
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ItemCard({
  item,
  projectId,
  initiallySaved = false,
  variant = "default",
}: {
  item: ExploreItem;
  /** When set, the bookmark button saves into/removes from THIS project
   *  instead of being a purely local toggle. */
  projectId?: string;
  /** Seeds the bookmark's starting visual state — true for cards the
   *  project Resources section already knows are saved; false (the
   *  default) everywhere else, matching today's behavior exactly. */
  initiallySaved?: boolean;
  /** Which paper subsection this card is rendered in — "key" for the
   *  WINNER-reordered Key Papers subsection, default ("default") for
   *  everywhere else including Latest Papers. Both drop the "★ Key paper"
   *  star/label (see signalBadge()); kept as an explicit prop, not inferred
   *  from item.raw, so the two subsections render consistently regardless
   *  of which item happens to carry raw.prior_signal. */
  variant?: "default" | "key";
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // GEO reports no ranking metric (see backend/explore-mcp/tools/search_datasets.py
  // — it never calls WINNER, there is no citation graph between datasets), so
  // signal is always null here and signalBadge() falls through to the plain date
  // badge below automatically. No dataset-specific badge logic needed or wanted:
  // a badge slot is exactly where a fabricated "ranked" label would be a lie.
  const badge = signalBadge(item, variant);
  const date = badge ? null : formatDate(item.date_iso);

  // Paper cards ALWAYS show a date, plus a citation count when one exists —
  // never both-or-nothing like the shared badge/date fallback above. Kept as
  // a kind-scoped branch (not a change to signalBadge()/date above) so
  // datasets/trials/gene sets/tools/grants keep their exact existing
  // treatment. `badge` here (when present) is always a citation string for
  // papers: signalBadge() only ever returns "★ ..." for stars (github tools,
  // not papers) or a plain "N citations"/priorCitations() string for papers.
  const paperDate = item.kind === "paper" ? formatDate(item.date_iso) : null;
  const paperCitations = item.kind === "paper" ? badge : null;
  const accent = ACCENT[item.kind] ?? "border-t-outline-variant";
  const imageUrl =
    item.kind === "episode" ? (item.raw?.image_url as string | undefined) : undefined;
  const geo = geoFields(item);
  const geneset = genesetFields(item);
  const trial = trialFields(item);
  const chembl = chemblFields(item);
  const opentargets = opentargetsFields(item);

  const open = () => {
    if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
  };

  const toggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pending) return;

    if (!projectId) {
      // No project context — EXACTLY today's behavior: a bare local
      // toggle, nothing persisted, no network call at all.
      setSaved((s) => !s);
      return;
    }

    const next = !saved;
    setSaved(next); // optimistic
    setSaveError(null);
    setPending(true);

    const res = next
      ? await saveToProjectAction(projectId, item)
      : await removeFromProjectAction(projectId, item.id);

    setPending(false);
    if (!res.ok) {
      setSaved(!next); // revert — the failure must be visible, not silent
      setSaveError(res.error);
    }
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={`glass-card group flex flex-col overflow-hidden rounded-xl border-t-4 ${accent} min-h-[220px] cursor-pointer`}
    >
      {imageUrl && (
        <div className="w-full aspect-video bg-surface-container-high overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        </div>
      )}

      <div className="flex flex-col flex-1 p-6">
        <div className="flex items-start gap-2 mb-4">
          {/* Signal badge only when a real metric exists; else the date; else
              NOTHING (never a vague label or a raw source slug). */}
          {item.kind === "paper" ? (
            (paperDate || paperCitations) && (
              <span className="inline-block px-3 py-1 rounded-full bg-surface-container-low text-secondary text-label-sm font-label-sm">
                {[paperDate, paperCitations].filter(Boolean).join(" · ")}
              </span>
            )
          ) : badge ? (
            <span className="inline-block px-3 py-1 rounded-full bg-primary text-on-primary text-label-sm font-label-sm">
              {badge}
            </span>
          ) : date ? (
            <span className="inline-block px-3 py-1 rounded-full bg-surface-container-low text-secondary text-label-sm font-label-sm">
              {date}
            </span>
          ) : null}

          <button
            onClick={toggleSave}
            disabled={pending}
            aria-label={saved ? "Remove bookmark" : "Save item"}
            className="text-secondary hover:text-primary transition-colors shrink-0 ml-auto disabled:opacity-50"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0" }}
            >
              bookmark
            </span>
          </button>
        </div>

        {/* Visible, not silent — a reverted save must say why. */}
        {saveError && (
          <p
            className="-mt-2 mb-3 font-body-sm text-body-sm text-error"
            role="alert"
            onClick={(e) => e.stopPropagation()}
          >
            {saveError}
          </p>
        )}

        <div>
          {/* Organism + sample count are what tells a researcher in one glance
              whether this dataset is worth opening — PROMINENT (bold, badge-sized
              text), not folded into the small-print summary line below. This is
              deliberately doing the job a relevance filter would otherwise do
              badly (see backend audit: GEO keyword search returns real but
              sometimes only-incidentally-relevant hits). */}
          {geo && (geo.organism || geo.sample_count != null) && (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {geo.organism && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 font-label-md text-label-md font-semibold">
                  {geo.organism}
                </span>
              )}
              {geo.sample_count != null && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 font-label-md text-label-md font-semibold">
                  {geo.sample_count.toLocaleString()} sample{geo.sample_count === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}

          <h3 className="font-headline-md text-lg leading-tight mb-2 text-on-background line-clamp-3">
            {item.title}
          </h3>
          {item.summary && (
            <p className="text-secondary text-body-sm font-body-sm line-clamp-2">{item.summary}</p>
          )}

          {/* Accession (explicit link, not just relying on the whole-card click),
              experiment type and platform — secondary metadata, smaller print is
              fine here since organism/sample-count above already carries the
              at-a-glance decision. */}
          {geo && (geo.accession || geo.experiment_type || geo.platform) && (
            <div className="mt-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-secondary text-body-sm font-body-sm">
              {geo.accession && item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary hover:underline font-medium"
                >
                  {geo.accession}
                </a>
              )}
              {geo.experiment_type && <span>{geo.experiment_type}</span>}
              {geo.platform && <span>{geo.platform}</span>}
            </div>
          )}

          {/* PAG type, source, size and nCoCo — same at-a-glance treatment
              as GEO's organism/sample-count above: this is what tells a
              researcher whether the gene set is worth opening. */}
          {geneset && (
            <div className="mt-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-secondary text-body-sm font-body-sm">
              {geneset.type_label && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-700 font-label-md text-label-md font-semibold">
                  {geneset.type_label}
                </span>
              )}
              {geneset.source && <span>{geneset.source}</span>}
              {typeof geneset.size === "number" && (
                <span>{geneset.size.toLocaleString()} genes</span>
              )}
              {typeof geneset.ncoco_score === "number" && geneset.ncoco_score > 0 && (
                <span>nCoCo {geneset.ncoco_score.toFixed(2)}</span>
              )}
            </div>
          )}

          {/* Trial status + why-stopped — VERBATIM, never paraphrased or run
              through any LLM step (see trialFields() above). Status badge is a
              plain pass-through of ClinicalTrials.gov's own overallStatus
              string; why_stopped renders in a blockquote to make clear it's a
              direct quote from the record, not house copy. */}
          {trial && (trial.overall_status || trial.why_stopped) && (
            <div className="mt-2 flex flex-col gap-1.5 text-secondary text-body-sm font-body-sm">
              {trial.overall_status && (
                <span
                  className={`inline-flex items-center self-start px-3 py-1 rounded-full font-label-md text-label-md font-semibold ${trialStatusClasses(trial.overall_status)}`}
                >
                  {trial.overall_status}
                </span>
              )}
              {trial.why_stopped && (
                <blockquote className="border-l-2 border-outline-variant/60 pl-2 italic line-clamp-3">
                  &ldquo;{trial.why_stopped}&rdquo;
                </blockquote>
              )}
            </div>
          )}

          {/* ChEMBL compound — mechanism fields (max_phase/action_type/mutation)
              when present, else bioactivity fields (standard_type/value/units,
              pchembl_value). mechanism_of_action / assay_description are
              already the item's `summary` (rendered above), so this block
              only surfaces the structured fields summary doesn't carry. */}
          {chembl && (chembl.molecule_chembl_id || chembl.max_phase != null || chembl.action_type
            || chembl.mutation || chembl.standard_type || chembl.pchembl_value != null) && (
            <div className="mt-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-secondary text-body-sm font-body-sm">
              {/* Canonical ChEMBL id — always shown, name-or-not, so the id is
                  never lost even once pref_name resolves and becomes the title. */}
              {chembl.molecule_chembl_id && (
                <span className="font-mono text-xs">{chembl.molecule_chembl_id}</span>
              )}
              {chembl.max_phase != null && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-rose-500/10 text-rose-700 font-label-md text-label-md font-semibold">
                  Phase {chembl.max_phase}
                </span>
              )}
              {chembl.action_type && (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-rose-500/10 text-rose-700 font-label-md text-label-md font-semibold">
                  {chembl.action_type}
                </span>
              )}
              {chembl.mutation && <span>{chembl.mutation}</span>}
              {chembl.standard_type && chembl.standard_value != null && (
                <span>
                  {chembl.standard_type} {chembl.standard_value}
                  {chembl.standard_units ? ` ${chembl.standard_units}` : ""}
                </span>
              )}
              {chembl.pchembl_value != null && <span>pChEMBL {chembl.pchembl_value}</span>}
            </div>
          )}

          {/* Open Targets — disease name and association score shown ONCE,
              combined into a single pill ("Disease · 0.83") rather than the
              disease name (title + pill) and the score (twice) each
              appearing redundantly. When scope had both a gene and a
              disease, a non-matched item (broader top-scoring context, not
              an answer to the query's disease) is visibly prefixed "Also
              associated with" — see sources/opentargets.py's
              _fetch_by_gene. Evidence-type chips are capped to the
              strongest few so this card stays roughly paper/compound-card
              height; tractability collapses to ONE plain-language line
              (see tractabilitySummary), never the raw SM/AB/PR codes. */}
          {opentargets && (opentargets.disease_name || opentargets.score != null) && (
            <div className="mt-2 flex flex-col gap-1.5 text-secondary text-body-sm font-body-sm">
              <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                {opentargets.matched_query_disease === false && (
                  <span className="text-xs italic text-tertiary">Also associated with</span>
                )}
                {opentargets.disease_name && (
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-700 font-label-md text-label-md font-semibold">
                    {opentargets.disease_name}
                    {opentargets.score != null ? ` · ${opentargets.score.toFixed(2)}` : ""}
                  </span>
                )}
              </div>
              {opentargets.evidence && opentargets.evidence.length > 0 && (
                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                  {[...opentargets.evidence]
                    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                    .slice(0, 3)
                    .map((e, i) => (
                      <span
                        key={`${e.type ?? "evidence"}-${i}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-container-low text-xs"
                      >
                        {evidenceLabel(e.type)}
                        {typeof e.score === "number" ? ` ${e.score.toFixed(2)}` : ""}
                      </span>
                    ))}
                </div>
              )}
              {tractabilitySummary(opentargets.tractability) && (
                <div className="text-xs">{tractabilitySummary(opentargets.tractability)}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Loading placeholder matching the card footprint.
export function SkeletonCard() {
  return (
    <div className="glass-card rounded-xl border-t-4 border-t-surface-variant min-h-[220px] p-6 animate-pulse">
      <div className="flex justify-between items-start mb-6">
        <div className="h-6 w-24 rounded-full bg-surface-container" />
        <div className="h-6 w-6 rounded bg-surface-container" />
      </div>
      <div className="mt-auto space-y-2">
        <div className="h-4 w-full rounded bg-surface-container" />
        <div className="h-4 w-2/3 rounded bg-surface-container" />
      </div>
    </div>
  );
}
