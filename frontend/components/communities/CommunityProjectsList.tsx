import Link from "next/link";
import type { CommunityProject } from "@/lib/server/communities";

/** A community's projects — summary rows only (name, description, stage).
 *  Clicking through still goes to the normal /projects/[id] page, which
 *  keeps its own project-member-only gate for the actual detail sections;
 *  a non-member community viewer clicking a project here lands on that
 *  page's existing "not found" state, same as today.
 *
 *  Title AND the "New project" action both live in the CollapsibleSection
 *  wrapper around this now (app/communities/[slug]/page.tsx, action prop) —
 *  this component is just the list. Unlike Announcements, Projects doesn't
 *  need to own its own CollapsibleSection: "New project" is a plain link
 *  with no client state to share with this content, so the page (a server
 *  component) can build it and pass it straight into the header. */
export default function CommunityProjectsList({ projects }: { projects: CommunityProject[] }) {
  return projects.length === 0 ? (
    <p className="font-body-sm text-body-sm text-secondary">No projects yet.</p>
  ) : (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {projects.map((p) => (
        <li key={p.id}>
          <Link
            href={`/projects/${p.id}`}
            className="glass-card rounded-lg p-4 flex flex-col gap-1 hover:border-primary/40 transition-colors h-full"
          >
            <span className="font-label-md text-label-md text-on-background">{p.name}</span>
            {p.description && (
              <span className="font-body-sm text-body-sm text-secondary line-clamp-2">
                {p.description}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
