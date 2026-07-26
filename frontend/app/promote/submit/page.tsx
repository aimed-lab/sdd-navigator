// Submit to the showcase — /promote/submit.
//
// Layout follows design/stitch/smartdrugdiscovery_submit_to_showcase_form,
// restyled in the shared design system. Nav/Footer from the root layout; the
// Stitch file's stale header ("Join Lab") and "© 2024" footer are ignored per
// design/SHELL.md.
//
// SERVER component so the auth check runs before any form HTML is sent: a
// signed-out visitor gets the gate, not a form that fails on submit.
// submitShowcaseAction re-checks server-side and RLS enforces ownership.

import Link from "next/link";
import SubmitShowcaseForm from "@/components/promote/SubmitShowcaseForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the session

export default async function SubmitShowcasePage() {
  const user = await getCurrentUser();

  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <Link
        href="/promote"
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to Promote
      </Link>

      <h1 className="font-headline-lg text-headline-lg text-on-background">
        Submit to the showcase
      </h1>
      <p className="mt-3 font-body-lg text-body-lg text-secondary">
        Share a case study, paper, white paper or lab milestone with the
        drug-discovery community.
      </p>

      <div className="mt-10">
        {user ? (
          <SubmitShowcaseForm />
        ) : (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">lock</span>
            <h2 className="mt-3 font-headline-md text-headline-md text-on-background">
              Sign in to submit
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary max-w-md mx-auto">
              Entries are credited to you so the community knows whose work it
              is. Browsing the showcase — and the post generator — stay open to
              everyone.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login?callbackUrl=%2Fpromote%2Fsubmit"
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Sign in to submit
              </Link>
              <Link
                href="/promote"
                className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Browse the showcase
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
