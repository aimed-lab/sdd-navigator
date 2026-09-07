// Saved items — /saved. The viewer's OWN saves with no project attached
// (see lib/server/projectResources.ts's "Personal (non-project) saves"
// section) — the "Just save it for me" choice in SaveItemPicker needed
// somewhere to actually show up; this is that somewhere, and it's new (no
// prior "my saved items"/"my library" surface existed anywhere in app/).
//
// SERVER component, REDIRECT for a signed-out visitor — same posture as
// app/projects/page.tsx: there's nothing public here. The redirect is a
// courtesy; listMySavedItems() (RLS: auth.uid() = user_id) is the actual
// guarantee.

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listMySavedItems } from "@/lib/server/projectResources";
import SavedItemsSection from "@/components/SavedItemsSection";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Saved items · SmartDrugDiscovery" };

export default async function SavedItemsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Fsaved");

  const result = await listMySavedItems();
  const resources =
    result.status === "ok" ? result.resources : { total: 0, tiles: [], recent: [], items: [] };

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20 flex flex-col gap-8">
      <div>
        <h1 className="font-display-lg text-[40px] leading-tight text-on-background">
          Saved items
        </h1>
        <p className="mt-2 font-body-md text-body-md text-secondary max-w-2xl">
          Items you saved for yourself, not tied to any project.
        </p>
      </div>

      <SavedItemsSection resources={resources} />
    </div>
  );
}
