// /pages/[slug] — a living page: notes with numbered citations, What's new,
// and every source collected. Server-rendered through the visitor's OWN
// Supabase session (lib/server/pages/pageView.ts), so RLS decides who can see
// it: signed-out visitors get public pages, owners and team members get theirs.
//
// A page the visitor may not read comes back from the database exactly like a
// page that doesn't exist, and both become the same plain 404, so a private
// page's existence is never revealed. Owner controls and the team panel are a
// convenience for the owner; the server actions and RLS are the real gate.

import { notFound } from "next/navigation";
import PageControls from "@/components/pages/PageControls";
import PageNotes from "@/components/pages/PageNotes";
import PageSources from "@/components/pages/PageSources";
import TeamPanel from "@/components/pages/TeamPanel";
import VisibilityBadge from "@/components/pages/VisibilityBadge";
import WhatsNew from "@/components/pages/WhatsNew";
import { getPageView } from "@/lib/server/pages/pageView";
import { VISIBILITY_INFO, creationLine, formatDay, initialSourceCount } from "@/lib/server/pages/pageViewHelpers";

export const dynamic = "force-dynamic"; // depends on the session

export default async function LivingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getPageView(slug);
  if (result.status === "not_found") notFound();
  if (result.status === "error") {
    return (
      <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16">
        <p className="font-body-md text-body-md text-error" role="alert">
          Couldn&apos;t load this page. Please try again.
        </p>
      </div>
    );
  }

  const { page, viewer, notes, evidence, updates, members } = result.view;
  const updated = formatDay(page.last_refreshed_at);
  const showTeam = viewer.isOwner || (page.visibility === "team" && members.length > 0);
  const empty = notes.length === 0 && evidence.length === 0;

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 flex flex-col gap-14">
      <header className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <VisibilityBadge visibility={page.visibility} />
          {updated && <span className="font-label-sm text-label-sm text-secondary">Updated {updated}</span>}
          {page.refresh_enabled && (
            <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-secondary">
              <span className="material-symbols-outlined text-[14px]">autorenew</span>
              Keeps itself updated
            </span>
          )}
        </div>
        <h1 className="mt-3 font-display-lg text-[40px] leading-tight text-on-background">{page.title}</h1>
        <p className="mt-2 font-body-md text-body-md text-secondary">{VISIBILITY_INFO[page.visibility].line}</p>
      </header>

      {(viewer.isOwner || showTeam) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {viewer.isOwner && (
            <PageControls
              pageId={page.id}
              slug={page.slug}
              title={page.title}
              visibility={page.visibility}
              refreshEnabled={page.refresh_enabled}
            />
          )}
          {showTeam && (
            <TeamPanel
              pageId={page.id}
              slug={page.slug}
              visibility={page.visibility}
              members={members}
              isOwner={viewer.isOwner}
            />
          )}
        </div>
      )}

      {empty ? (
        <div className="glass-panel rounded-2xl p-8 text-center max-w-3xl">
          <p className="font-body-md text-body-md text-secondary">
            Nothing has been collected for this page yet. It fills in after its first update.
          </p>
        </div>
      ) : (
        <>
          <PageNotes notes={notes} evidence={evidence} />
          <WhatsNew
            updates={updates}
            createdLine={creationLine(
              page.created_at,
              initialSourceCount(evidence.map((e) => e.id), updates)
            )}
          />
          <PageSources evidence={evidence} />
        </>
      )}
    </div>
  );
}
