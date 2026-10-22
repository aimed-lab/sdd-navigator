"use client";

// The one big question box on Explore, with a scope picker ("Everything" by
// default, or Papers, Preprints, Clinical trials, ...) and optional example
// topic chips. Submitting calls onSubmit(topic, scope); the pages send that to
// scopeHref() (lib/server/explore/exploreLayout.ts).

import { useState } from "react";
import { SCOPES, type ScopeKey } from "@/lib/server/explore/exploreLayout";

export default function QuestionBox({
  initial = "",
  initialScope = "all",
  placeholder,
  examples,
  showScope = true,
  onSubmit,
}: {
  initial?: string;
  initialScope?: ScopeKey;
  placeholder: string;
  /** Topic chips under the box; clicking one searches it (in the chosen scope). */
  examples?: string[];
  showScope?: boolean;
  onSubmit: (topic: string, scope: ScopeKey) => void;
}) {
  const [value, setValue] = useState(initial);
  const [scope, setScope] = useState<ScopeKey>(initialScope);

  return (
    <section className="max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          if (q) onSubmit(q, scope);
        }}
        className="relative"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type="text"
          aria-label="Your question"
          placeholder={placeholder}
          className="w-full h-16 px-6 pr-16 bg-white border border-outline-variant/40 rounded-[16px] focus:ring-2 focus:ring-primary/20 focus:border-primary text-body-lg font-body-lg placeholder:text-secondary/50 transition-all shadow-[0_1px_2px_rgba(25,28,30,0.04)]"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute right-3 top-3 bottom-3 btn-primary px-5 rounded-xl flex items-center justify-center"
        >
          <span className="material-symbols-outlined">search</span>
        </button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {showScope && (
          <label className="flex items-center gap-2 font-label-md text-label-md text-secondary">
            Search in
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeKey)}
              className="bg-white border border-outline-variant/40 rounded-lg px-3 py-1.5 font-label-md text-label-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {SCOPES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {examples && examples.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-label-sm text-label-sm text-secondary">Try</span>
            {examples.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSubmit(t, scope)}
                className="px-3.5 py-1.5 rounded-full bg-white border border-outline-variant/40 font-label-md text-label-md text-on-background hover:border-primary hover:text-primary transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
