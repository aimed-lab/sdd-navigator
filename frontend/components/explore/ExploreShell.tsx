// The frame of the redesigned Explore pages: the warm background and page
// width, nothing else. (The old ExplorePageFrame, with its category strip, is
// still used by the podcast pages.)

export default function ExploreShell({ banner, children }: { banner?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-32">
        {banner}
        {children}
      </div>
    </div>
  );
}
