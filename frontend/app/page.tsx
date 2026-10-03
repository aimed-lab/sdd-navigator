// Landing page ("/") — layout follows
// design/stitch/smartdrugdiscovery_landing_page/code.html, using the shared
// design tokens (tailwind.config.ts) and the .glass-card / .btn-primary /
// .btn-outline component classes from globals.css. Nav + Footer come from the
// root layout, which also owns the pt-16 offset for the fixed nav.
//
// SERVER component — fetches live Communities and Showcase data directly via
// lib/server/communities.ts / lib/server/showcase.ts, the same way any other
// server-rendered page in this app does (e.g. app/collaborate/page.tsx).
// Explore's own communities widget (components/explore/CommunitiesResultsSection.tsx)
// goes through /api/communities-summary only because Explore is "use client"
// and needs something fetchable from the browser — that API route is not a
// required intermediary for a server component, which can call these
// functions directly, same as this file's own getCurrentUser() already did
// before this rebuild.
//
// BOTH live sections degrade to NOTHING (not an error, not an empty
// placeholder) on failure or an empty result — same contract Explore's
// communities widget already has (see CommunitiesResultsSection's own "renders
// null when items.length === 0" comment): listCommunities()/listMyMemberships()
// already self-degrade to [] / {} internally on a Supabase error, and
// listShowcase() (which CAN throw ServerConfigError) is wrapped in its own
// try/catch here for the same reason. Either way, a failed or empty section
// just isn't rendered — the page below it is unaffected.
//
// NOTE: the hero used to have a second button ("Start project") — dropped
// along with the getCurrentUser() session read that built its href, since
// Projects is no longer a nav destination and the hero is now one primary
// action (Explore) under the tagline, not two competing ones.

import Link from "next/link";
import { Fragment } from "react";
import CommunityCard from "@/components/communities/CommunityCard";
import ShowcaseCard from "@/components/promote/ShowcaseCard";
import { listCommunities, listMyMemberships, type CommunitySummaryItem } from "@/lib/server/communities";
import { listShowcase } from "@/lib/server/showcase";
import type { ShowcaseEntry } from "@/lib/showcaseTypes";

const PILLARS = [
  {
    title: "Explore",
    href: "/explore",
    icon: "travel_explore",
    body: "Discover papers, tools, trials, grants, and podcasts across drug discovery — all in one searchable place.",
    cta: "Explore Resources",
  },
  {
    title: "Collaborate",
    href: "/collaborate",
    icon: "handshake",
    body: "Share what your lab offers and find researchers to work with.",
    cta: "Find Partners",
  },
  {
    title: "Promote",
    href: "/promote",
    icon: "campaign",
    body: "Showcase your papers and work to the community.",
    cta: "Share Your Work",
  },
] as const;

const HOW_IT_WORKS = [
  "Explore resources",
  "Collaborate with researchers",
  "Promote your work",
] as const;

export default async function Home() {
  // Up to 4, newest-name-first (listCommunities()' own order — no "recent"
  // concept on a community). Membership merged in the SAME shape
  // app/api/communities-summary/route.ts builds for Explore's own
  // Communities category, so CommunityCard's badge (Admin/Member/Pending/
  // nothing) renders identically here. listCommunities()/listMyMemberships()
  // already self-degrade to []/{} on a Supabase error (see their own
  // comments) — the try/catch is only a backstop for something neither
  // anticipates, e.g. getSession() itself throwing.
  let communities: CommunitySummaryItem[] = [];
  try {
    const [all, memberships] = await Promise.all([listCommunities(), listMyMemberships()]);
    communities = all.slice(0, 4).map((community) => {
      const m = memberships[community.id];
      const member = m?.status === "active";
      return { community, member, role: member ? m.role : null, pending: m?.status === "pending" };
    });
  } catch (e) {
    console.error("Home: listCommunities/listMyMemberships failed", e);
    communities = [];
  }

  // Up to 3 published entries, newest first (listShowcase()'s own default
  // order/filter — published=true, no type restriction). Unlike
  // listCommunities(), listShowcase() DOES throw (ServerConfigError when
  // getDb() can't build a client) rather than self-degrading, so this needs
  // its own try/catch to keep the "never an error, just nothing" contract.
  let showcaseEntries: ShowcaseEntry[] = [];
  try {
    showcaseEntries = (await listShowcase()).slice(0, 3);
  } catch (e) {
    console.error("Home: listShowcase failed", e);
    showcaseEntries = [];
  }

  return (
    <>
      {/* Hero — the tagline (Chen's own wording) IS the headline now, not a
          restatement of the nav. One sentence under it, one primary action
          (Explore) — the second button ("Start project") is gone along with
          the session read it needed, since Projects isn't a nav destination
          any more and a landing hero pointing at two different next steps is
          weaker than one. */}
      <section className="relative flex flex-col items-center justify-center text-center px-margin-mobile md:px-margin-desktop py-24 md:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary-fixed/20 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto space-y-8">
          <h1 className="font-display-lg text-display-lg md:text-[64px] md:leading-[1.1] text-on-background">
            Innovator-driven, community-based drug discovery.
          </h1>
          <p className="font-body-lg text-body-lg text-secondary max-w-2xl mx-auto">
            Researchers form communities, find what they need, and share what
            they publish.
          </p>
          <div className="flex items-center justify-center pt-4">
            <Link
              href="/explore"
              className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg w-full md:w-auto text-center"
            >
              Start Exploring
            </Link>
          </div>
        </div>
      </section>

      {/* Communities — live, up to 4. What the platform is actually built
          around, and previously not mentioned anywhere on this page. Same
          CommunityCard Explore's own Communities category renders (see
          components/explore/CommunitiesResultsSection.tsx) — not a second
          card style for the home page. Renders nothing (no heading, no
          empty state) when there are zero communities. */}
      {communities.length > 0 && (
        <section className="px-margin-mobile md:px-margin-desktop py-16 md:py-20 max-w-container-max mx-auto">
          <div className="flex items-center justify-between gap-3 mb-8">
            <h2 className="font-headline-lg text-headline-lg text-on-background">Communities</h2>
            <Link
              href="/communities"
              className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0"
            >
              All communities
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {communities.map((c) => (
              <CommunityCard
                key={c.community.id}
                community={c.community}
                member={c.member}
                role={c.role ?? undefined}
                pending={c.pending}
                memberCount={c.community.member_count ?? 0}
              />
            ))}
          </div>
        </section>
      )}

      {/* Showcase — live, up to 3 published entries. Real work rather than a
          description of a "Promote" pillar. Same ShowcaseCard /promote
          itself renders (non-featured variant — this is a preview row, not
          a second showcase page). Renders nothing when there are zero
          published entries. */}
      {showcaseEntries.length > 0 && (
        <section className="px-margin-mobile md:px-margin-desktop py-16 md:py-20 max-w-container-max mx-auto">
          <div className="flex items-center justify-between gap-3 mb-8">
            <h2 className="font-headline-lg text-headline-lg text-on-background">
              From the community
            </h2>
            <Link
              href="/promote"
              className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0"
            >
              View all
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {showcaseEntries.map((entry) => (
              <ShowcaseCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {/* Explore / Collaborate / Promote — moved below the live content.
          These used to appear three times before anything real: the nav,
          the hero headline, and here. Now it's twice (nav, here), and only
          after Communities/Showcase/ColaboFest have already shown what the
          platform actually is. */}
      <section className="px-margin-mobile md:px-margin-desktop py-16 md:py-20 max-w-container-max mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          {PILLARS.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="glass-card p-8 rounded-xl flex flex-col gap-6 group"
            >
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-3xl">{p.icon}</span>
              </div>
              <div>
                <h2 className="font-headline-md text-headline-md text-on-background mb-3">
                  {p.title}
                </h2>
                <p className="font-body-md text-body-md text-secondary">{p.body}</p>
              </div>
              <div className="mt-auto pt-4 flex items-center text-primary font-label-md text-label-md group-hover:translate-x-2 transition-transform">
                {p.cta}
                <span className="material-symbols-outlined ml-2">arrow_forward</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="py-12 border-t border-surface-variant/30 px-margin-mobile md:px-margin-desktop">
        <div className="max-w-container-max mx-auto flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12 font-label-md text-label-md text-secondary">
          {HOW_IT_WORKS.map((step, i) => (
            <Fragment key={step}>
              {i > 0 && <div className="hidden md:block w-12 h-px bg-outline-variant" />}
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-sm text-label-sm">
                  {i + 1}
                </span>
                <span>{step}</span>
              </div>
            </Fragment>
          ))}
        </div>
      </section>
    </>
  );
}
