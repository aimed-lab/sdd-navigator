// Profile setup / onboarding — /onboarding.
//
// Where new users land after confirming their email (signup passes
// ?next=/onboarding through the confirmation link), and reachable any time from
// Settings. Nothing here is mandatory — see the "Skip for now" link in
// OnboardingForm.
//
// SERVER component so the auth check runs before any form HTML is sent: a
// signed-out visitor gets the gate, not a form whose every save would 401.

import Link from "next/link";
import OnboardingForm from "@/components/profile/OnboardingForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the session

export default async function OnboardingPage() {
  const user = await getCurrentUser();

  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <header className="text-center mb-10">
        <h1 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
          Build your researcher profile
        </h1>
        <p className="mt-3 font-body-lg text-body-lg text-secondary">
          Join the precision network for drug-discovery breakthroughs.
        </p>
      </header>

      {user ? (
        <OnboardingForm />
      ) : (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-primary">lock</span>
          <h2 className="mt-3 font-headline-md text-headline-md text-on-background">
            Sign in to set up your profile
          </h2>
          <p className="mt-2 font-body-md text-body-md text-secondary max-w-md mx-auto">
            Your profile is tied to your account, so there needs to be one first.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login?callbackUrl=%2Fonboarding"
              className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Log in
            </Link>
            <Link
              href="/signup?callbackUrl=%2Fonboarding"
              className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Create an account
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
