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

function VerificationBadge({ provider }: { provider: Provider }) {
  // Deliberately no warning icon for "not_yet_verified" — per the catalog's
  // own docs it usually means a bot-blocked or JS-rendered site, not doubt
  // about the company. Only "verified" gets a check mark; the other two
  // states are plain text.
  const isVerified = provider.verification === "verified";
  return (
    <span
      className={
        "inline-flex items-center gap-1 font-label-sm text-label-sm shrink-0 " +
        (isVerified ? "text-primary" : "text-secondary")
      }
    >
      {isVerified && <span className="material-symbols-outlined text-[14px]">check_circle</span>}
      {provider.verification_label}
    </span>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  return (
    <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/20">
      <div className="flex items-start justify-between gap-3">
        <p className="font-label-md text-label-md text-on-background font-medium">
          {provider.name ?? "Unnamed provider"}
        </p>
        <VerificationBadge provider={provider} />
      </div>

      {/* ONE line, taken VERBATIM from the catalog's own description field —
          never generated, never rewritten. Rendered exactly as received. */}
      {provider.description && (
        <p className="mt-1 font-body-sm text-body-sm text-secondary">{provider.description}</p>
      )}

      {(provider.business_types.length > 0 || provider.countries_served.length > 0) && (
        <p className="mt-1 font-body-sm text-body-sm text-secondary/80">
          {provider.business_types.join(", ")}
          {provider.business_types.length > 0 && provider.countries_served.length > 0 && " · "}
          {provider.countries_served.join(", ")}
        </p>
      )}

      {provider.website && (
        <a
          href={provider.website}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block font-label-sm text-label-sm text-primary hover:underline"
        >
          Visit website
        </a>
      )}
    </div>
  );
}

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
              <p className="font-body-md text-body-md text-secondary">
                Couldn&apos;t reach the provider catalog right now.
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
