"use client";

// The shared frame for /explore and /explore/<topic>: warm background, page
// width, serif heading + muted subtitle, search box, and the category chips.
// Both pages render through this, so apart from content (heading text,
// results) they are indistinguishable. Don't restyle one without the other.

import CategoryStrip from "@/components/CategoryStrip";
import PageHeader from "@/components/PageHeader";

export default function ExplorePageFrame({
  banner,
  title,
  subtitle,
  statsLine,
  search,
  scopeChips,
  chips,
  children,
}: {
  /** Optional strip above the heading (project breadcrumb / "Saving to"). */
  banner?: React.ReactNode;
  title: React.ReactNode;
  subtitle: string;
  /** One muted line under the subtitle (the feed's live stats). */
  statsLine?: string;
  search: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    placeholder: string;
  };
  scopeChips?: React.ReactNode;
  chips: { selected: string | null; onSelect: (kind: string | null) => void; query?: string };
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-32">
        {banner}

        <PageHeader title={title} subtitle={subtitle} statsLine={statsLine} />

        {/* Search */}
        <section className="max-w-3xl mb-8">
          <form onSubmit={search.onSubmit} className="relative">
            <input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              type="text"
              placeholder={search.placeholder}
              className="w-full h-14 px-5 pr-16 bg-white border border-outline-variant/40 rounded-[14px] focus:ring-2 focus:ring-primary/20 focus:border-primary text-body-md font-body-md placeholder:text-secondary/50 transition-all"
            />
            <button
              type="submit"
              aria-label="Search"
              className="absolute right-2.5 top-2.5 bottom-2.5 btn-primary px-5 rounded-lg flex items-center justify-center"
            >
              <span className="material-symbols-outlined">search</span>
            </button>
          </form>
        </section>

        {scopeChips}

        {/* Category strip: horizontal scroll on mobile. The Podcast chip routes to
            /explore/podcast rather than filtering inline. */}
        <div className="mt-6">
          <CategoryStrip
            selected={chips.selected}
            onSelect={chips.onSelect}
            query={chips.query}
          />
        </div>

        {children}
      </div>
    </div>
  );
}
