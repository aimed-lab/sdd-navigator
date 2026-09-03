// Placeholder content for a section key that has no real content yet
// (resources, events, who_can_help). The title itself now lives in the
// CollapsibleSection wrapper around this (app/communities/[slug]/page.tsx)
// — this component is just the "nothing here yet" body, shown per spec as
// the actual rendering for these keys, not a stub hiding something
// unfinished.
export default function EmptySection() {
  return (
    <p className="font-body-md text-body-md text-secondary">Nothing here yet.</p>
  );
}
