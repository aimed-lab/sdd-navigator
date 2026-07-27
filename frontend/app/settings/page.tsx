// Account settings — /settings.
//
// SERVER component: the auth check runs before any HTML is sent, and a
// signed-out visitor is REDIRECTED to /login rather than shown a gate. That's
// the difference from /onboarding and /promote/submit — settings has nothing
// meaningful to show a stranger, so a gate panel would just be a dead end.
//
// The user's email is read from the validated session here and passed down: the
// delete-account confirmation compares against it, and it must not come from
// anything the client could edit.

import { redirect } from "next/navigation";
import SettingsPanels from "@/components/profile/SettingsPanels";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the session

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Fsettings");

  return (
    <div className="max-w-5xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <header className="mb-10">
        <h1 className="font-headline-lg text-headline-lg text-on-background">Settings</h1>
        <p className="mt-3 font-body-lg text-body-lg text-secondary">
          Your profile, your research interests, and who can see them.
        </p>
      </header>

      <SettingsPanels email={user.email ?? ""} />
    </div>
  );
}
