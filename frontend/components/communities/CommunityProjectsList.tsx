import Link from "next/link";
import type { CommunityProject } from "@/lib/server/communities";

/** A community's projects — summary rows only (name, description, stage).
 *  Clicking through still goes to the normal /projects/[id] page, which
 *  keeps its own project-member-only gate for the actual detail sections;
 *  a non-member community viewer clicking a project here lands on that
 *  page's existing "not found" state, same as today. */
export default function CommunityProjectsList({
  projects,
  communityId,
}: {
  projects: CommunityProject[];
  /** Present only for a member (who can start a project here) — passed
   *  through to the "New project" link's ?community= param. */
  communityId: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-headline-md text-headline-md text-on-background">Projects</h2>
        {communityId && (
          <Link
            href={`/projects/new?community=${communityId}`}
            className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New project
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
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
      )}
    </div>
  );
}
