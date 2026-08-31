// Titled placeholder for a section key that has no real content yet
// (resources, announcements, events, who_can_help) — per spec, this is
// intended as the actual rendering for these keys, not a stub hiding
// something unfinished. Same shape as MembersSection/CommunityProjectsList
// (a plain <h2> + body text, no card chrome) so an admin who enables one
// sees exactly what every other viewer will.
export default function EmptySection({ title }: { title: string }) {
  return (
    <section>
      <h2 className="font-headline-md text-headline-md text-on-background mb-2">{title}</h2>
      <p className="font-body-md text-body-md text-secondary">Nothing here yet.</p>
    </section>
  );
}
