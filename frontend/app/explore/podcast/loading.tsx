// Next's automatic loading UI for this route segment — shown while the async
// Server Component in page.tsx is fetching from Supabase.

const GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6";

function SkeletonEpisodeCard() {
  return (
    <div className="glass-card rounded-xl border-t-4 border-t-surface-variant overflow-hidden animate-pulse">
      <div className="w-full aspect-video bg-surface-container" />
      <div className="p-6 space-y-3">
        <div className="h-6 w-16 rounded-full bg-surface-container" />
        <div className="h-5 w-full rounded bg-surface-container" />
        <div className="h-4 w-5/6 rounded bg-surface-container" />
        <div className="flex gap-2 pt-2">
          <div className="h-6 w-16 rounded-full bg-surface-container" />
          <div className="h-6 w-20 rounded-full bg-surface-container" />
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20">
      <div className={GRID}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonEpisodeCard key={i} />
        ))}
      </div>
    </section>
  );
}
