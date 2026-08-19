"use client";

// Per-checklist-item "Find a provider" panel — the second door beside "Ask
// for help" (see ChecklistSection.tsx). Ask for help finds a collaborator;
// this finds a supplier. Both stay visible.
//
// Fetches on open, not on mount — a checklist can have many items, and
// nobody wants N provider lookups firing for a page load just because the
// items rendered. State: idle -> loading -> loaded | error, all local, no
// caching across opens (a lookup is cheap and the underlying catalog can
// change).
//
// RESILIENCE: /api/find-provider never 500s (see that route + the backend's
// own contract) — it degrades to { ...error: true } on any failure, which
// this component renders as a plain "couldn't reach the provider catalog"
// message with the Ask-for-help fallback still visible. The checklist item
// itself is never affected either way.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Provider } from "@/types/provider";

type PanelState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; matched: string[]; providers: Provider[] };

function VerificationBadge({ provider }: { provider: Provider }) {
  // Deliberately no warning icon for "not_yet_verified" — per the catalog's
  // own docs it usually means a bot-blocked or JS-rendered site, not doubt
  // about the company. Only "verified" gets a check mark; the other two
  // states are plain text.
  const isVerified = provider.verification === "verified";
  return (
    <span
      className={
        "inline-flex items-center gap-1 font-label-sm text-label-sm " +
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

      {(provider.business_types.length > 0 || provider.countries_served.length > 0) && (
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          {provider.business_types.join(", ")}
          {provider.business_types.length > 0 && provider.countries_served.length > 0 && " · "}
          {provider.countries_served.join(", ")}
        </p>
      )}

      {provider.capability_tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provider.capability_tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full bg-surface-container text-secondary font-label-sm text-label-sm"
            >
              {tag}
            </span>
          ))}
        </div>
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

export default function FindProviderPanel({
  projectId,
  itemId,
  itemLabel,
  askForHelpHref,
  onClose,
}: {
  projectId: string;
  itemId: string;
  itemLabel: string;
  askForHelpHref: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PanelState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetch("/api/find-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, itemId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState({ status: "error" });
          return;
        }
        setState({
          status: "loaded",
          matched: data.matched_capabilities ?? [],
          providers: data.providers ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, itemId]);

  return (
    <div className="mt-3 p-4 bg-surface-container rounded-xl border border-outline-variant/30">
      <div className="flex items-center justify-between gap-4">
        <p className="font-label-sm text-label-sm text-secondary">
          Find a provider for &ldquo;{itemLabel}&rdquo;
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-secondary hover:text-on-background"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {state.status === "loading" && (
        <p className="mt-3 font-body-sm text-body-sm text-secondary">Searching the provider catalog…</p>
      )}

      {state.status === "error" && (
        <div className="mt-3">
          <p className="font-body-sm text-body-sm text-secondary">
            Couldn&apos;t reach the provider catalog right now.
          </p>
          <Link
            href={askForHelpHref}
            className="mt-2 inline-block font-label-sm text-label-sm text-primary hover:underline"
          >
            Ask for help instead
          </Link>
        </div>
      )}

      {state.status === "loaded" && (
        <div className="mt-3">
          {state.matched.length > 0 ? (
            <p className="font-body-sm text-body-sm text-secondary">
              Matched to: {state.matched.join(", ")}
            </p>
          ) : (
            <p className="font-body-sm text-body-sm text-secondary">
              Couldn&apos;t confidently match this item to a provider capability.
            </p>
          )}

          {state.matched.length > 0 && state.providers.length > 0 && (
            <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
              {state.providers.map((p, i) => (
                <ProviderCard key={`${p.name ?? "provider"}-${i}`} provider={p} />
              ))}
            </div>
          )}

          {state.matched.length > 0 && state.providers.length === 0 && (
            <p className="mt-2 font-body-sm text-body-sm text-secondary">
              No providers found for that capability yet.
            </p>
          )}

          <Link
            href={askForHelpHref}
            className="mt-3 inline-block font-label-sm text-label-sm text-primary hover:underline"
          >
            Ask for help instead
          </Link>
        </div>
      )}
    </div>
  );
}
