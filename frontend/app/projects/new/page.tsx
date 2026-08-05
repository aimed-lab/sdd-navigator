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
import CreateProjectForm from "@/components/projects/CreateProjectForm";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Create a project · SmartDrugDiscovery" };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ colabofest?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Fprojects%2Fnew");

  const { colabofest } = await searchParams;

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-20">
      <CreateProjectForm colabofest={colabofest === "1"} />
    </div>
  );
}
