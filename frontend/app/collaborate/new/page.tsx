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

import Link from "next/link";
import CreatePostForm from "@/components/collaborate/CreatePostForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the session

export default async function NewCollabPostPage() {
  const user = await getCurrentUser();

  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <Link
        href="/collaborate"
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to the board
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
          <CreatePostForm />
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
                href="/login?callbackUrl=%2Fcollaborate%2Fnew"
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
