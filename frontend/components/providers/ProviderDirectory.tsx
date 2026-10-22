"use client";

// The search box, category chips and card grid of /collaborate/providers. The
// whole list is passed in (22 companies), so searching and filtering are
// instant and client side: every word typed must appear in the name, services
// or description.

import { useMemo, useState } from "react";
import { categoryCounts, filterProviders, type Provider } from "@/lib/server/providers/core";
import ProviderCard from "./ProviderCard";

function chip(active: boolean) {
  return (
    "px-5 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-primary text-on-primary"
      : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary")
  );
}

export default function ProviderDirectory({ providers }: { providers: Provider[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const chips = useMemo(() => categoryCounts(providers), [providers]);
  const shown = useMemo(() => filterProviders(providers, query, category), [providers, query, category]);

  return (
    <div>
      <div className="relative max-w-3xl">
        <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-secondary">
          search
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you need done? e.g. synthesis, antibodies, docking"
          aria-label="What do you need done?"
          className="w-full h-14 bg-white border border-outline-variant/40 rounded-[14px] pl-12 pr-4 font-body-md text-body-md text-on-background placeholder:text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className={chip(category === null)} onClick={() => setCategory(null)}>
          All ({providers.length})
        </button>
        {chips.map((c) => (
          <button
            key={c.category}
            type="button"
            className={chip(category === c.category)}
            onClick={() => setCategory(category === c.category ? null : c.category)}
          >
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      <p className="mt-6 text-sm text-secondary/80" aria-live="polite">
        {shown.length} {shown.length === 1 ? "provider" : "providers"}
        {(query.trim() || category) && " matching"}
      </p>

      {shown.length === 0 ? (
        <div className="mt-6 tile p-8 text-center max-w-xl" style={{ background: "var(--type-other-bg)" }}>
          <h3 className="font-title text-[22px] font-medium text-on-background">Nothing matches that yet</h3>
          <p className="mt-2 font-body-md text-body-md text-secondary">
            Try fewer words or another category, or tell us about a provider we should add.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {shown.map((p) => (
            <ProviderCard key={p.slug} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}
