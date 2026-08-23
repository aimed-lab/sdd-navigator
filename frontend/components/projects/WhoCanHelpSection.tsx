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
// project's checklist items (computed once each, at add/edit time), a
// SINGLE catalog query over that combined set, and a plain intersection to
// work out which item(s) each result covers. Zero new LLM calls, zero new
// classification, one more shape drawn from data this app already has.
//
// THE GAP LINE IS NEVER GENERATED. It's built here, in code, by quoting the
// project's own checklist item label(s) a provider matched — see
// buildGapLine below. A more polished paraphrase ("can run the rodent
// washout-recovery study your reversibility item needs") would need an LLM
// call this design deliberately doesn't spend; quoting the item directly is
// the honest zero-cost equivalent, and it still names the actual gap.
//
// THREE STATES, NOT TWO — same fix as ServiceProvidersSection's own
// 2026-08-23 correction: a catalog outage and "nothing to recommend" must
// never read the same to whoever's looking at this page.

import { useEffect, useState } from "react";
import type { MatchedChecklistItem, ProjectProvider } from "@/types/provider";
import { ProviderCard } from "@/components/projects/ProviderCard";

type FetchState =
  | { status: "loading" }
  | { status: "unavailable" } // the catalog call itself failed
  | { status: "no_match" } // catalog answered; nothing (or nothing to search) — a genuine "no"
  | { status: "found"; providers: ProjectProvider[] };

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
 *  paraphrase, see this file's own header comment. */
function buildGapLine(matchedItems: MatchedChecklistItem[]): string {
  const labels = matchedItems.map((i) => `“${i.label}”`);
  if (labels.length === 1) return `Matches your checklist item ${labels[0]}`;
  if (labels.length <= 3) {
    const last = labels[labels.length - 1];
    const rest = labels.slice(0, -1);
    return `Matches your checklist items ${rest.join(", ")}, and ${last}`;
  }
  return `Matches your checklist items ${labels.slice(0, 2).join(", ")}, and ${labels.length - 2} more`;
}

export default function WhoCanHelpSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

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
        setState(providers.length > 0 ? { status: "found", providers } : { status: "no_match" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const entries: HelpEntry[] =
    state.status === "found"
      ? state.providers.map((provider, i) => ({
          kind: "provider" as const,
          key: `${provider.name ?? "provider"}-${i}`,
          provider,
        }))
      : [];

  return (
    <section className="mb-20">
      <h2 className="font-headline-md text-headline-md text-on-background mb-2">Who can help</h2>
      <p className="font-body-md text-body-md text-secondary mb-6">
        Matched to the gaps in this project&apos;s checklist — not what a provider does in
        general, what it can do for this team.
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

      {state.status === "no_match" && (
        <p className="font-body-md text-body-md text-secondary">
          Nothing in this project&apos;s checklist currently needs outside help.
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
        </div>
      )}
    </section>
  );
}
