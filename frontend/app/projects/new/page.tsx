// Create a project — /projects/new.
//
// Layout follows frontend/design/projects/STRUCTURE.md, screens 2 and 3: one
// centered form, both entry points ("New project" and the ColaboFest banner)
// served by the same page, distinguished by ?colabofest=1. Nav/Footer come
// from the root layout — the Stitch files' own stripped-down nav is discarded.
//
// SERVER component so the redirect happens before any form HTML is sent,
// matching /projects and /inbox: a signed-out visitor never sees the form.
// createProjectAction re-checks server-side regardless, and RLS enforces
// lead_id/membership at the database — three layers, of which this one is
// purely the experience.

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getCommunityById } from "@/lib/server/communities";
import CreateProjectForm from "@/components/projects/CreateProjectForm";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Create a project · SmartDrugDiscovery" };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    // Built from the ACTUAL incoming search params, not hardcoded to plain
    // "/projects/new" — a signed-out visitor hitting
    // /projects/new?colabofest=1 previously lost that query string here and
    // landed back on the plain form after logging in, not the ColaboFest
    // one they actually asked for.
    const params = await searchParams;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") qs.set(key, value);
      else if (Array.isArray(value) && value.length > 0) qs.set(key, value[0]);
    }
    const target = qs.toString() ? `/projects/new?${qs.toString()}` : "/projects/new";
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}`);
  }

  const { colabofest, community } = await searchParams;
  const communityId = typeof community === "string" ? community : undefined;

  // The form only ever has the id (from the URL) but needs the SLUG to
  // redirect back into /communities/<slug> after a successful create —
  // resolved here, server-side, rather than making the form do its own
  // fetch. A bad/stale id (community deleted, typo'd URL) just degrades to
  // no redirect-back — communitySlug stays undefined, create still works,
  // createProjectAction/create_project_with_lead re-check membership on
  // the id regardless of whether this lookup succeeds.
  const communitySlug = communityId ? (await getCommunityById(communityId))?.slug : undefined;

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20">
      <CreateProjectForm
        colabofest={colabofest === "1"}
        communityId={communityId}
        communitySlug={communitySlug}
      />
    </div>
  );
}
