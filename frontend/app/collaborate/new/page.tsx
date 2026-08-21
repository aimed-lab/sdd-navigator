// Create a collaboration post — /collaborate/new.
//
// Layout follows design/stitch/smartdrugdiscovery_create_collaboration_post,
// restyled in the shared design system. Nav/Footer come from the root layout;
// the Stitch file's own header (with the stale "Join Lab" button) and footer are
// ignored per design/SHELL.md.
//
// SERVER component so the auth check happens before any form HTML is sent: a
// signed-out visitor gets the sign-in gate, not a form that fails on submit.
// createPostAction re-checks server-side anyway, and RLS enforces ownership at
// the database — three layers, of which this one is purely the experience.
//
// THE CHECKLIST BRIDGE: a project's "Ask for help" link routes here with
// ?checklist_item_id=&project_id=&title=&description=&need= — read below and
// passed straight to CreatePostForm as prefill props. None of this is
// trusted as-is: checklist_item_id is just an opaque string until
// createCollabPost's caller (this session's own user) inserts it, and title/
// description/need are plain prefill text a user can freely edit before
// submitting, same as if they'd typed them themselves.

import Link from "next/link";
import CreatePostForm from "@/components/collaborate/CreatePostForm";
import { getCurrentUser } from "@/lib/auth";
import { getCommunityBySlug } from "@/lib/server/communities";

export const dynamic = "force-dynamic"; // depends on the session

export default async function NewCollabPostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const str = (v: string | string[] | undefined): string | undefined =>
    typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;

  const checklistItemId = str(params.checklist_item_id);
  const projectId = str(params.project_id);
  const initialTitle = str(params.title);
  const initialDescription = str(params.description);
  const initialNeed = str(params.need);
  const communitySlug = str(params.community);

  const [user, community] = await Promise.all([
    getCurrentUser(),
    communitySlug ? getCommunityBySlug(communitySlug) : Promise.resolve(null),
  ]);

  const returnTo = projectId
    ? `/projects/${projectId}`
    : communitySlug
      ? `/collaborate?community=${encodeURIComponent(communitySlug)}`
      : "/collaborate";
  const backLabel = projectId ? "Back to the project" : "Back to the board";

  // Preserves the full querystring in the login callback, so a signed-out
  // visitor who clicked "Ask for help" comes back to the SAME prefilled
  // form after logging in, not a blank one.
  const qs = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : []))
  ).toString();
  const loginCallback = `/collaborate/new${qs ? `?${qs}` : ""}`;

  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <Link
        href={returnTo}
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        {backLabel}
      </Link>

      <h1 className="font-headline-lg text-headline-lg text-on-background">
        Create a collaboration post
      </h1>
      <p className="mt-3 font-body-lg text-body-lg text-secondary">
        Say what your lab can offer, what you&apos;re looking for, or both — posts
        with both tend to find partners fastest.
      </p>

      <div className="mt-10">
        {user ? (
          <CreatePostForm
            initialTitle={initialTitle}
            initialDescription={initialDescription}
            initialNeed={initialNeed}
            checklistItemId={checklistItemId}
            communityId={community?.id}
            communityName={community?.name}
            returnTo={returnTo}
          />
        ) : (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">lock</span>
            <h2 className="mt-3 font-headline-md text-headline-md text-on-background">
              Sign in to post
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary max-w-md mx-auto">
              Posts are attributed to your profile so collaborators know who
              they&apos;re working with. Browsing the board stays open to everyone.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(loginCallback)}`}
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Sign in to post
              </Link>
              <Link
                href="/collaborate"
                className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Browse the board
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
