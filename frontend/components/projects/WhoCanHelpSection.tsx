"use client";

// WhoCanHelpSection — "who and what can help with this project", project-
// level. Separate from Resources (papers/datasets/trials — things a
// researcher READS) and separate from the per-checklist-item "Find a
// service provider" panel (ServiceProvidersSection) that stays exactly as
// it was. This section answers a different question at a different
// altitude: not "what does this ONE item need" but "who can help with
// ANYTHING in this project right now".
//
// SAME MATCHER, REUSED, NOT REBUILT. Every provider here comes from
// find_providers_for_project_async (backend/explore-mcp/tools/
// find_provider.py) — the union of capability terms ALREADY stored on the
// project's checklist items (computed once each, at add/edit time) AND on
// the project's own description (computed once, at creation — see
// lib/server/projects.ts's createProject()), a SINGLE catalog query over
// that combined set, and a plain intersection to work out which item(s) —
// or the description — each result covers. Zero new LLM calls, zero new
// classification, one more shape drawn from data this app already has.
//
// THE GAP LINE IS NEVER GENERATED. It's built here, in code, by quoting the
// project's own checklist item label(s) a provider matched, or naming the
// description as the source when that's where the match came from — see
// buildGapLine below. A more polished paraphrase ("can run the rodent
// washout-recovery study your reversibility item needs") would need an LLM
// call this design deliberately doesn't spend; quoting/naming the source
// directly is the honest zero-cost equivalent, and it still names the
// actual gap.
//
// RANKED AND CAPPED. Providers arrive sorted by how many of this project's
// needs each one covers (most first) — only the top VISIBLE_CAP show by
// default, with a "Show N more" to see the rest, so the strongest matches
// aren't buried in a long list.
//
// FOUR STATES, NOT TWO — same fix as ServiceProvidersSection's own
// 2026-08-23 correction, extended: a catalog outage, "nothing has been
// assessed yet" (no description classification and no checklist), and
// "assessed, nothing to recommend" must never read the same to whoever's
// looking at this page.

import { useEffect, useState } from "react";
import type { MatchedChecklistItem, ProjectProvider } from "@/types/provider";
import { ProviderCard } from "@/components/projects/ProviderCard";

type FetchState =
  | { status: "loading" }
  | { status: "unavailable" } // the catalog call itself failed
  // Neither the description nor any checklist item has ever been
  // classified — there's nothing to say yet, not a "no". See the
  // `assessed` field on the API response and this file's own header
  // comment on the two sources.
  | { status: "unassessed" }
  | { status: "no_match" } // assessed; genuinely nothing matched — a real "no"
  | { status: "found"; providers: ProjectProvider[] };

// Cap what's shown by default — a wall of 10-15 provider cards buries the
// good matches. Providers already arrive RANKED by how many of this
// project's needs each one covers (find_provider.py's _attach_matched_items
// — highest first), so the cap keeps the strongest matches, not an
// arbitrary slice.
const VISIBLE_CAP = 5;

// STRUCTURED TO GROW: "who or what can help" is answered by a provider
// today, and by a tool or a person later — search_tools.py already returns
// real GitHub repos with star counts, and search_people.py already returns
// platform/lab-registry profiles; neither is wired into this section yet.
// HelpEntry is the seam: it's a one-member union today ONLY because
// there's only one real source. Adding "tool" or "person" later means
// adding a member here and a `case` to the switch in the render below —
// nothing about the fetch, the layout, or the three-state handling above
// needs to change, because none of that is provider-specific; it's already
// phrased as "entries", not "providers".
type HelpEntry = { kind: "provider"; key: string; provider: ProjectProvider };

/** Quotes the checklist item label(s) a provider matched — never a
 *  paraphrase, see this file's own header comment. A description-sourced
 *  match has no single label to quote (the description is a paragraph, not
 *  a short item), so it says so instead — still never a generated
 *  paraphrase of what the description says, just naming its source. */
function buildGapLine(matchedItems: MatchedChecklistItem[]): string {
  const checklistLabels = matchedItems
    .filter((i) => i.source === "checklist" && i.label)
    .map((i) => `“${i.label}”`);
  const fromDescription = matchedItems.some((i) => i.source === "description");

  const parts: string[] = [];
  if (checklistLabels.length === 1) {
    parts.push(`your checklist item ${checklistLabels[0]}`);
  } else if (checklistLabels.length > 1 && checklistLabels.length <= 3) {
    const last = checklistLabels[checklistLabels.length - 1];
    const rest = checklistLabels.slice(0, -1);
    parts.push(`your checklist items ${rest.join(", ")}, and ${last}`);
  } else if (checklistLabels.length > 3) {
    parts.push(
      `your checklist items ${checklistLabels.slice(0, 2).join(", ")}, and ${checklistLabels.length - 2} more`
    );
  }
  if (fromDescription) parts.push("your project description");

  return `Matches ${parts.join(" and ")}`;
}

export default function WhoCanHelpSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setShowAll(false);

    fetch("/api/find-providers-for-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState({ status: "unavailable" });
          return;
        }
        const providers: ProjectProvider[] = data.providers ?? [];
        if (providers.length > 0) {
          setState({ status: "found", providers });
        } else if (data.assessed === false) {
          setState({ status: "unassessed" });
        } else {
          setState({ status: "no_match" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const allEntries: HelpEntry[] =
    state.status === "found"
      ? state.providers.map((provider, i) => ({
          kind: "provider" as const,
          key: `${provider.name ?? "provider"}-${i}`,
          provider,
        }))
      : [];
  // Already ranked (see VISIBLE_CAP's own comment) — slicing here keeps the
  // strongest matches, not an arbitrary subset.
  const entries = showAll ? allEntries : allEntries.slice(0, VISIBLE_CAP);
  const hiddenCount = allEntries.length - entries.length;

  return (
    <section className="mb-20">
      <h2 className="font-headline-md text-headline-md text-on-background mb-2">Who can help</h2>
      <p className="font-body-md text-body-md text-secondary mb-6">
        Matched to the gaps in this project&apos;s description and checklist — not what a
        provider does in general, what it can do for this team.
        {state.status === "found" && allEntries.length > VISIBLE_CAP && (
          <> Showing the top {VISIBLE_CAP}, ranked by how many of this project&apos;s needs each
          one covers.</>
        )}
      </p>

      {state.status === "loading" && (
        <p className="font-body-md text-body-md text-secondary">Checking for providers…</p>
      )}

      {state.status === "unavailable" && (
        <p className="font-body-md text-body-md text-secondary" role="alert">
          The provider catalog is unavailable right now — this isn&apos;t about your project.
          Check back later.
        </p>
      )}

      {state.status === "unassessed" && (
        <p className="font-body-md text-body-md text-secondary">
          This section will fill in as the project takes shape — add a description or checklist
          items to see who can help.
        </p>
      )}

      {state.status === "no_match" && (
        <p className="font-body-md text-body-md text-secondary">
          Nothing in this project&apos;s description or checklist currently needs outside help.
        </p>
      )}

      {state.status === "found" && (
        <div className="space-y-3">
          {entries.map((entry) => {
            // See HelpEntry's own comment: a new kind adds a case here, not
            // a new section.
            switch (entry.kind) {
              case "provider":
                return (
                  <ProviderCard
                    key={entry.key}
                    provider={entry.provider}
                    gapLine={buildGapLine(entry.provider.matched_items)}
                  />
                );
            }
          })}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="font-label-sm text-label-sm text-primary hover:underline"
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
