// ProviderCard — the one visual shape a catalog provider renders as,
// shared between ServiceProvidersSection (per checklist item) and
// WhoCanHelpSection (project-level). Extracted so both surfaces render the
// SAME provider look rather than drifting into two — this is deliberately
// NOT ItemCard's accent-bar/kind-badge grid idiom (Resources' own look);
// providers are a different kind of thing ("who can help", not "what to
// read") and should read as one consistent shape of their own, not a
// second flavor of Resources.

import type { Provider } from "@/types/provider";

export function VerificationBadge({ provider }: { provider: Provider }) {
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

export function ProviderCard({
  provider,
  gapLine,
}: {
  provider: Provider;
  // The ONE line naming the gap this provider fills for THIS project —
  // built from the project's own checklist item labels (WhoCanHelpSection),
  // never generated/paraphrased. Omitted entirely in the per-item context
  // (ServiceProvidersSection already states the item above the whole list;
  // repeating it per-card there would be redundant).
  gapLine?: string;
}) {
  return (
    <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/20">
      <div className="flex items-start justify-between gap-3">
        <p className="font-label-md text-label-md text-on-background font-medium">
          {provider.name ?? "Unnamed provider"}
        </p>
        <VerificationBadge provider={provider} />
      </div>

      {gapLine && (
        <p className="mt-1 font-body-sm text-body-sm text-on-background">{gapLine}</p>
      )}

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
