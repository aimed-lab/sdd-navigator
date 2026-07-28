// Next's automatic loading UI for this route segment — shown while the async
// Server Component in page.tsx is fetching from Supabase. Replaces the old
// client-side `loading` state (this page no longer fetches client-side at all).

export default function Loading() {
  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-10 md:py-14">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10">
        <div className="animate-pulse space-y-4">
          <div className="w-full aspect-video rounded-xl bg-surface-container" />
          <div className="h-8 w-2/3 rounded bg-surface-container" />
          <div className="h-4 w-full rounded bg-surface-container" />
          <div className="h-4 w-5/6 rounded bg-surface-container" />
        </div>
        <div />
      </div>
    </div>
  );
}
