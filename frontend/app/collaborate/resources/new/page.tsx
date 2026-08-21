// "Add what your lab can share" — /collaborate/resources/new.
//
// SERVER component, same reasoning as app/collaborate/new/page.tsx: the auth
// check happens before any form HTML is sent, so a signed-out visitor gets the
// sign-in gate rather than a form that fails on submit. createResourceAction
// re-checks server-side anyway, and RLS enforces ownership (and, when a
// community is set, community membership / openness) at the database.
//
// ?community=<slug> carries the selected chip through from /collaborate, same
// idiom as the checklist bridge in app/collaborate/new/page.tsx — resolved
// here into a communityId, passed to the form as a plain prop.

import Link from "next/link";
import AddResourceForm from "@/components/collaborate/AddResourceForm";
import { getCurrentUser } from "@/lib/auth";
import { getCommunityBySlug } from "@/lib/server/communities";

export const dynamic = "force-dynamic"; // depends on the session

export default async function NewResourcePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const str = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;

  const communitySlug = str(params.community);
  const [user, community] = await Promise.all([
    getCurrentUser(),
    communitySlug ? getCommunityBySlug(communitySlug) : Promise.resolve(null),
  ]);

  const returnTo = communitySlug ? `/collaborate?community=${encodeURIComponent(communitySlug)}` : "/collaborate";
  const loginCallback = `/collaborate/resources/new${communitySlug ? `?community=${encodeURIComponent(communitySlug)}` : ""}`;

  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <Link
        href={returnTo}
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to the board
      </Link>

      <h1 className="font-headline-lg text-headline-lg text-on-background">
        Add what your lab can share
      </h1>
      <p className="mt-3 font-body-lg text-body-lg text-secondary">
        A technique, a piece of equipment, a vector, a model — anything another
        lab could use. Just a name and a type to start; everything else is
        optional.
      </p>

      <div className="mt-10">
        {user ? (
          <AddResourceForm
            communityId={community?.id ?? null}
            communityName={community?.name ?? null}
            returnTo={returnTo}
          />
        ) : (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">lock</span>
            <h2 className="mt-3 font-headline-md text-headline-md text-on-background">
              Sign in to share a resource
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary max-w-md mx-auto">
              Resources are attributed to your account so people know who to
              ask. Browsing the registry stays open to everyone.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(loginCallback)}`}
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Sign in
              </Link>
              <Link href="/collaborate" className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
                Browse the board
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
