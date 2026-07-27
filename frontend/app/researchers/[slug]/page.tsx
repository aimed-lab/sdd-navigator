// Public researcher profile — /researchers/[slug].
//
// SERVER component, public data only: getResearcherProfile() reads through the
// anon client (lib/server/researchers.ts), keyed strictly by the `slug` route
// param. It never looks at the viewer's session, so this page cannot render
// differently depending on who is signed in — the poster's slug in, the
// poster's profile out, always.
//
// getResearcherProfile() already returns null when the row doesn't exist OR
// is_public is false, so a private profile's slug 404s here exactly like a
// slug that doesn't exist. Callers (PostCard's "View profile") are expected
// not to link here at all for a private owner — collab_post_owners() nulls
// the slug for exactly that reason — but this page enforces the same rule
// independently, since a slug can always be typed by hand.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getResearcherProfile, type ResearcherWorkFull } from "@/lib/server/researchers";

export const dynamic = "force-dynamic";

const WORK_ICON: Record<ResearcherWorkFull["type"], string> = {
  paper: "article",
  tool: "construction",
  dataset: "dataset",
};

function fieldsSummary(fields: Record<string, unknown>): string {
  const label = fields.name ?? fields.title;
  if (typeof label === "string" && label.trim()) return label.trim();
  const entries = Object.entries(fields).filter(([, v]) => typeof v === "string" && v.trim());
  return entries.length > 0 ? String(entries[0][1]) : "";
}

export default async function ResearcherProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getResearcherProfile(slug);
  if (!data) notFound();

  const { profile, works, resources, related } = data;
  const location = [profile.institution, profile.affiliation, profile.country]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10 lg:gap-14 items-start">
        {/* ── MAIN COLUMN ─────────────────────────────────────────────── */}
        <main className="min-w-0 space-y-12">
          <header className="glass-panel rounded-2xl p-8">
            <h1 className="font-headline-lg text-headline-lg text-on-background">
              {profile.name}
            </h1>
            {location && (
              <p className="mt-2 font-body-md text-body-md text-secondary">{location}</p>
            )}

            {profile.research_focus && (
              <p className="mt-4 font-body-md text-body-md text-on-background">
                {profile.research_focus}
              </p>
            )}

            {profile.bio && (
              <p className="mt-4 font-body-md text-body-md text-secondary whitespace-pre-wrap">
                {profile.bio}
              </p>
            )}

            {profile.interests && profile.interests.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {profile.interests.map((i) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm"
                  >
                    {i}
                  </span>
                ))}
              </div>
            )}

            {(profile.linkedin_url || profile.website_url) && (
              <div className="mt-6 flex flex-wrap gap-4">
                {profile.website_url && (
                  <a
                    href={profile.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                  >
                    <span className="material-symbols-outlined text-base">language</span>
                    Website
                  </a>
                )}
                {profile.linkedin_url && (
                  <a
                    href={profile.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                  >
                    <span className="material-symbols-outlined text-base">link</span>
                    LinkedIn
                  </a>
                )}
              </div>
            )}
          </header>

          {works.length > 0 && (
            <section>
              <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
                Published work
              </h2>
              <div className="space-y-4">
                {works.map((w) => (
                  <div key={w.id} className="glass-panel rounded-xl p-6">
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-primary shrink-0">
                        {WORK_ICON[w.type]}
                      </span>
                      <div className="min-w-0">
                        {w.url ? (
                          <a
                            href={w.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-label-md text-label-md text-on-background hover:text-primary hover:underline underline-offset-4"
                          >
                            {w.title}
                          </a>
                        ) : (
                          <p className="font-label-md text-label-md text-on-background">
                            {w.title}
                          </p>
                        )}
                        {(w.journal || w.year) && (
                          <p className="mt-1 font-body-sm text-body-sm text-secondary">
                            {[w.journal, w.year].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {w.description && (
                          <p className="mt-2 font-body-sm text-body-sm text-secondary">
                            {w.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {resources.length > 0 && (
            <section>
              <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
                Lab resources
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {resources.map((r) => (
                  <div key={r.id} className="glass-panel rounded-xl p-5">
                    <span className="inline-block px-3 py-1 rounded-full bg-secondary-container/40 text-on-surface-variant font-label-sm text-label-sm capitalize">
                      {r.category.replace(/_/g, " ")}
                    </span>
                    {fieldsSummary(r.fields) && (
                      <p className="mt-3 font-body-md text-body-md text-on-background">
                        {fieldsSummary(r.fields)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        {/* ── RIGHT RAIL ──────────────────────────────────────────────── */}
        {related.length > 0 && (
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
            <h2 className="font-headline-md text-headline-md text-on-background">
              Related researchers
            </h2>
            <div className="space-y-3">
              {related.slice(0, 5).map((r) => {
                const card = (
                  <div className="glass-panel rounded-xl p-4">
                    <p className="font-label-md text-label-md text-on-background">{r.name}</p>
                    {(r.institution || r.affiliation) && (
                      <p className="mt-0.5 font-body-sm text-body-sm text-secondary">
                        {r.institution ?? r.affiliation}
                      </p>
                    )}
                  </div>
                );
                return r.profile_slug ? (
                  <Link key={r.id} href={`/researchers/${r.profile_slug}`} className="block">
                    {card}
                  </Link>
                ) : (
                  <div key={r.id}>{card}</div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
