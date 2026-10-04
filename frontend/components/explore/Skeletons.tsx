// Calm loading placeholders in the editorial look (replaces ItemCard's
// SkeletonCard on Explore and search pages).

export function BlockSkeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`rounded-[14px] bg-[#eeece6] animate-pulse ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-32 space-y-6">
        <BlockSkeleton className="h-12 w-2/3" />
        <BlockSkeleton className="h-14 max-w-3xl" />
        <BlockSkeleton className="h-64" />
      </div>
    </div>
  );
}
