"use client";

// Service providers section — the dedicated results area a checklist
// item's "Find a service provider" button scrolls to (see
// ChecklistSection.tsx). NOT an inline per-item panel: this is one shared
// section, rendered once, further down the page — clicking a different
// item's button re-targets the SAME section rather than opening a second
// one, so only one item's results ever show at a time.
//
// ZERO LLM CALLS ON CLICK. selectedItem.matchedCapabilities is already
// known (computed once at add/edit time — see lib/server/
// checklistClassify.ts) — the fetch below (POST /api/find-provider) is a
// pure catalog search over those terms, nothing more.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Provider } from "@/types/provider";
import { ProviderCard } from "@/components/projects/ProviderCard";

export type SelectedServiceItem = {
  id: string;
  label: string;
  matchedCapabilities: string[];
  askForHelpHref: string;
};

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; providers: Provider[] };

export default function ServiceProvidersSection({
  projectId,
  selectedItem,
}: {
  projectId: string;
  selectedItem: SelectedServiceItem | null;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const sectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedItem) return;

    let cancelled = false;
    setState({ status: "loading" });

    fetch("/api/find-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, itemId: selectedItem.id }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "loaded", providers: data.providers ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
    // Re-fetch whenever a DIFFERENT item is selected — not on every render.
  }, [projectId, selectedItem?.id]);

  useEffect(() => {
    if (selectedItem) {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedItem?.id]);

  return (
    <section ref={sectionRef} className="mb-20 scroll-mt-6">
      {selectedItem && (
        <>
          <h2 className="font-headline-md text-headline-md text-on-background mb-2">
            Service providers
          </h2>
          <p className="font-body-md text-body-md text-secondary mb-1">
            Service providers who can help with this
          </p>
          <p className="font-body-md text-body-md text-on-background font-medium mb-2">
            &ldquo;{selectedItem.label}&rdquo;
          </p>
          {selectedItem.matchedCapabilities.length > 0 && (
            <p className="font-body-sm text-body-sm text-secondary mb-6">
              Matched to: {selectedItem.matchedCapabilities.join(", ")}
            </p>
          )}

          {state.status === "loading" && (
            <p className="font-body-md text-body-md text-secondary">Matching service providers…</p>
          )}

          {state.status === "error" && (
            <div>
              {/* Distinct from the genuine-zero-match state below on
                  purpose — same shape as Explore's CategoryEmptyCard
                  `failed` case. A catalog outage and "nothing matched"
                  read identically to a user unless the copy itself says
                  which one happened. */}
              <p className="font-body-md text-body-md text-secondary" role="alert">
                The provider catalog is unavailable right now — this isn&apos;t about your project.
              </p>
              <Link
                href={selectedItem.askForHelpHref}
                className="mt-2 inline-block font-label-sm text-label-sm text-primary hover:underline"
              >
                Ask for help instead
              </Link>
            </div>
          )}

          {state.status === "loaded" && state.providers.length > 0 && (
            <div className="space-y-3">
              {state.providers.map((p, i) => (
                <ProviderCard key={`${p.name ?? "provider"}-${i}`} provider={p} />
              ))}
            </div>
          )}

          {state.status === "loaded" && state.providers.length === 0 && (
            <div>
              <p className="font-body-md text-body-md text-secondary">
                No providers matched this item yet.
              </p>
              <Link
                href={selectedItem.askForHelpHref}
                className="mt-2 inline-block font-label-sm text-label-sm text-primary hover:underline"
              >
                Ask for help instead
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}
