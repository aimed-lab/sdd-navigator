"use client";

import Link from "next/link";

// The scope the Explore feed is currently built from, as removable chips.
//
// Shown only for the PERSONALIZED feed — the blank-input feed scoped to the
// signed-in user's saved interests — so the answer to "why am I seeing this?"
// is on the page, next to the search bar that would change it.
//
// Editing is deliberately a one-way door out of the personalized feed: removing
// a chip hands the remaining terms to `onEdit` as an ordinary search, because a
// feed that is no longer the user's saved interests should not keep claiming to
// be. Saving a different set is a profile edit, which is what the Edit link is.

export default function ScopeChips({
  terms,
  onEdit,
}: {
  terms: string[];
  /** Called with what's left after a chip is removed (possibly empty). */
  onEdit: (remaining: string[]) => void;
}) {
  if (terms.length === 0) return null;

  return (
    <div className="max-w-3xl mx-auto mb-8 flex flex-wrap items-center justify-center gap-2">
      <span className="font-label-md text-label-md text-secondary mr-1">
        Your interests:
      </span>

      {terms.map((term) => (
        <span
          key={term}
          className="inline-flex items-center gap-1 pl-4 pr-2 py-1.5 rounded-full bg-secondary-container text-primary font-label-md text-label-md"
        >
          {term}
          <button
            type="button"
            onClick={() => onEdit(terms.filter((t) => t !== term))}
            aria-label={`Remove ${term} from this feed`}
            className="flex items-center rounded-full hover:bg-primary/10 transition-colors"
          >
            <span className="material-symbols-outlined text-base leading-none">close</span>
          </button>
        </span>
      ))}

      <Link
        href="/onboarding"
        className="ml-1 font-label-md text-label-md text-primary underline underline-offset-2 hover:opacity-80"
      >
        Edit interests
      </Link>
    </div>
  );
}
