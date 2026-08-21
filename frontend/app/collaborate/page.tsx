// Collaborate board — /collaborate.
//
// Layout follows design/stitch/smartdrugdiscovery_premium_collaborate_board,
// restyled in the shared design system. Nav/Footer come from the root layout —
// the Stitch file's own header/footer (with the stale "Join Lab" link and a
// "© 2024" line) are ignored per design/SHELL.md.
//
// SERVER component: it reads through lib/server/collab.ts directly, so the board
// is rendered with data already in the HTML — no client fetch, no loading
// flash. Search and filters are URL state (?q=&filter=&area=&community=), which
// makes every view linkable and keeps the page a plain GET form. Only the
// Connect modal and the "Add to the board" choice menu are client-side.
//
// COMMUNITIES (database/migrations/2026-08-20_communities.sql): a community
// chip is ONE MORE piece of URL state (?community=<slug>), resolved
// server-side into an id and threaded into BOTH reads below — listCollabPosts
// and listResources each take a communityId and filter to it. No selection
// (the default) shows everything, same as today.
//
// HIERARCHY (2026-08-21 cleanup): community is the SCOPE (which group's board
// you're looking at — a segmented control, its neutral option "All
// communities"); type is a FILTER within that scope (offering / seeking /
// etc. — lighter pills, neutral option "All types"). They used to be two
// visually-identical rows of pills each starting with a chip that just said
// "All" — nothing distinguished them. Topics (research areas, e.g. "AI drug
// discovery") are a SUBJECT, not an intent, so they no longer share a row
// with the type filter either; they get their own row. Folding them into the
// search box was the other option, but that would trade a one-click filter
// for typing the exact area name back — not a win for a handful of chips.

import Link from "next/link";
import AddToBoardButton from "@/components/collaborate/AddToBoardButton";
import CommunityPanel from "@/components/collaborate/CommunityPanel";
import PostCard from "@/components/collaborate/PostCard";
import ResourceCard from "@/components/collaborate/ResourceCard";
import InlineFeedback from "@/components/feedback/InlineFeedback";
import { getCurrentUser } from "@/lib/auth";
import { listCollabPosts, type BoardFilter, type CollabPost } from "@/lib/server/collab";
import { listResources } from "@/lib/server/collaborate";
import {
  getCommunityBySlug,
  getCommunityStats,
  getMembership,
  listCommunities,
  listPendingRequests,
  type Membership,
  type PendingRequest,
} from "@/lib/server/communities";

export const dynamic = "force-dynamic"; // board content changes per request

const FILTERS: { value: BoardFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "offering", label: "Offering" },
  { value: "seeking_team", label: "Seeking Teammates" },
  { value: "seeking_resources", label: "Seeking Resources" },
];

/** Build a board URL preserving the other params. */
function boardHref(params: { q?: string; filter?: string; area?: string; community?: string }) {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.filter && params.filter !== "all") sp.set("filter", params.filter);
  if (params.area) sp.set("area", params.area);
  if (params.community) sp.set("community", params.community);
  const qs = sp.toString();
  return qs ? `/collaborate?${qs}` : "/collaborate";
}

// Type filter + topic chips — the lighter, FILTER-level pill.
//
// SELECTED, NOT ACTION (2026-08-21 design pass): an active chip used to be
// solid primary green — the exact same treatment as "Add to the board" and
// "Join", so five unrelated green elements all read as equally-important
// buttons with no entry point. A selected chip isn't an action to take,
// it's a STATE to notice — so it now uses secondary-container (the existing
// light blue-lavender token, not a new color) with bold text instead.
function chip(active: boolean) {
  return (
    "px-4 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-secondary-container text-on-secondary-container font-semibold"
      : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary")
  );
}

// Community segmented-control segment — the heavier, SCOPE-level control.
// Visually distinct from chip(): square-ish segments sharing one bordered
// track, not free-floating pills, so it doesn't read as "one more chip row".
// Same "selected, not action" reasoning as chip() above — secondary-container,
// not primary green.
function segment(active: boolean) {
  return (
    "px-4 py-2 rounded-md font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-secondary-container text-on-secondary-container font-semibold shadow-sm"
      : "text-on-background hover:bg-surface-container")
  );
}

/** The invitation card — shown as the last grid tile, and on its own when a
 *  filter/search matches nothing. */
function InvitationCard({
  heading,
  body,
  href = "/collaborate/new",
  cta = "Create a post",
}: {
  heading: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  return (
    <Link
      href={href}
      className="group border-2 border-dashed border-outline-variant/50 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-surface-container-low transition-all min-h-[18rem]"
    >
      <span className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
        <span className="material-symbols-outlined text-primary text-3xl">handshake</span>
      </span>
      <h3 className="font-headline-md text-lg text-on-background mb-2">{heading}</h3>
      <p className="font-body-md text-body-md text-secondary mb-5 max-w-xs">{body}</p>
      <span className="flex items-center gap-2 font-label-md text-label-md text-primary">
        {cta}
        <span className="material-symbols-outlined">arrow_forward</span>
      </span>
    </Link>
  );
}

export default async function CollaboratePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const q = one(sp.q).trim();
  const area = one(sp.area).trim();
  const communitySlug = one(sp.community).trim();
  const rawFilter = one(sp.filter);
  const filter: BoardFilter = (FILTERS.some((f) => f.value === rawFilter)
    ? rawFilter
    : "all") as BoardFilter;

  const [communities, community, user] = await Promise.all([
    listCommunities(),
    communitySlug ? getCommunityBySlug(communitySlug) : Promise.resolve(null),
    getCurrentUser(),
  ]);
  const communityId = community?.id;

  const [posts, resources] = await Promise.all([
    listCollabPosts({ q, area, filter, communityId }),
    listResources({ communityId }),
  ]);
  const signedIn = user !== null;

  // Membership/activity reads only fire when a community is actually
  // selected — they're meaningless (and, for stats, an extra RPC) on the
  // unscoped board.
  let membership: Membership = { state: "none", isLead: false };
  let pendingRequests: PendingRequest[] = [];
  let stats = { memberCount: 0, joinedLast7d: 0 };
  if (communityId) {
    [membership, stats] = await Promise.all([
      getMembership(communityId),
      getCommunityStats(communityId),
    ]);
    if (membership.isLead) pendingRequests = await listPendingRequests(communityId);
  }

  // Area chips are derived from the posts actually on the board, so they can
  // never offer a filter that returns nothing.
  const areas = Array.from(
    new Set((posts as CollabPost[]).flatMap((p) => p.research_areas))
  )
    .sort()
    .slice(0, 8);

  const filtered = q || area || filter !== "all";
  const newPostHref = `/collaborate/new${communitySlug ? `?community=${encodeURIComponent(communitySlug)}` : ""}`;
  const newResourceHref = `/collaborate/resources/new${communitySlug ? `?community=${encodeURIComponent(communitySlug)}` : ""}`;
  const sharePath = `/collaborate?community=${encodeURIComponent(communitySlug)}`;
  const isEmptyCommunity = Boolean(community) && posts.length === 0 && resources.length === 0;
  // Nothing to show, and no filter narrowing it — the friendly empty card
  // (community-scoped or the plain "Be the first to post" invitation) is
  // about to say so itself, in warmer words. A count line reading "0 posts
  // · 0 resources" directly above that card was saying the same thing
  // twice; suppressed here, but ONLY when there's no active filter — with a
  // filter applied, "Clear filters" is genuinely useful (the community/board
  // isn't actually empty, this view of it is), so the line stays.
  const nothingToShowUnfiltered =
    posts.length === 0 && resources.length === 0 && !filtered;

  // Activity — "show what is happening" for a selected community. Built
  // entirely from data already fetched above (posts/resources are public
  // reads regardless of community; nothing here is manufactured when there
  // is genuinely nothing — see isEmptyCommunity's own branch below, which
  // this never overrides).
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const recentActivity = communityId
    ? [
        ...posts.map((p) => ({ label: p.title, created_at: p.created_at, kind: "post" as const })),
        ...resources.map((r) => ({
          label: (r.fields.name as string) || "Untitled resource",
          created_at: r.created_at,
          kind: "resource" as const,
        })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3)
    : [];
  const newThisWeek = communityId
    ? [...posts, ...resources].filter(
        (x) => Date.now() - new Date(x.created_at).getTime() < WEEK_MS
      ).length
    : 0;
  const labsSharing = communityId
    ? new Set(resources.map((r) => (r.fields.pi_lab as string) || r.owner_name || r.id)).size
    : 0;
  const hasActivity = posts.length > 0 || resources.length > 0;

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-6 md:py-8">
      {/* Header — names the selected community (2026-08-21 design pass):
          "Collaborate" becomes a breadcrumb back to the unscoped board, and
          the community's own name takes the H1, so the page always says
          where you are instead of leaving the title generic while only the
          description below it changes. The join/share row folds in here
          too, beside the name — there is no standalone panel whose only
          content is those two buttons anymore. */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          {community ? (
            <Link
              href="/collaborate"
              className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors"
            >
              Collaborate
            </Link>
          ) : null}
          <h1 className="font-headline-lg text-headline-lg md:text-[32px] md:leading-tight text-on-background">
            {community ? community.name : "Collaborate"}
          </h1>
          <p className="mt-2 font-body-md text-body-md text-secondary max-w-2xl">
            {community
              ? community.description || `Posts and shared resources for ${community.name}.`
              : "Share what your lab offers, find what you need, and build teams — for the drug discovery community."}
          </p>
          {community && (
            <div className="mt-3">
              <CommunityPanel
                communityId={community.id}
                isOpen={community.is_open}
                sharePath={sharePath}
                membership={membership}
                pendingRequests={pendingRequests}
              />
            </div>
          )}
        </div>
        <AddToBoardButton newPostHref={newPostHref} newResourceHref={newResourceHref} />
      </header>

      {/* Search (plain GET form — keeps every view linkable) */}
      <form action="/collaborate" method="get" className="mt-5">
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        {area && <input type="hidden" name="area" value={area} />}
        {communitySlug && <input type="hidden" name="community" value={communitySlug} />}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-secondary">
            search
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search collaborations, resources, people…"
            aria-label="Search the collaboration board"
            className="w-full glass-panel rounded-xl pl-12 pr-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </form>

      {/* Community — the SCOPE. A segmented control, not a pill row: heavier,
          one bordered track, so it visually outranks the filter row below. */}
      {communities.length > 0 && (
        <div className="mt-4 inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-surface-container-low border border-outline-variant/30">
          <Link href={boardHref({ q, area, filter })} className={segment(!communitySlug)}>
            All communities
          </Link>
          {communities.map((c) => (
            <Link
              key={c.id}
              href={boardHref({ q, area, filter, community: communitySlug === c.slug ? "" : c.slug })}
              className={segment(communitySlug === c.slug)}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {/* Type — a FILTER within that scope. Lighter pills. */}
      <div className="mt-3 flex flex-wrap gap-2 items-center">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={boardHref({ q, area, filter: f.value, community: communitySlug })}
            className={chip(filter === f.value)}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Topics — a SUBJECT, not an intent, so it's a row of its own rather
          than sharing the type-filter row it used to sit in. */}
      {areas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <span className="font-label-sm text-label-sm text-secondary/70 uppercase mr-1">
            Topics
          </span>
          {areas.map((a) => (
            <Link
              key={a}
              href={boardHref({ q, filter, community: communitySlug, area: area === a ? "" : a })}
              className={chip(area === a)}
            >
              {a}
            </Link>
          ))}
        </div>
      )}

      {/* Result line / activity summary — suppressed entirely when there is
          genuinely nothing to show and no filter is active (see
          nothingToShowUnfiltered above): the empty card just below already
          says so, in warmer words, and a "0 posts · 0 resources" line sitting
          directly above it was saying the same thing twice. A community with
          real activity gets the "show what is happening" summary (counts +
          recent additions, by name) instead of a bare count. */}
      {!nothingToShowUnfiltered && (
        <>
          {communityId && hasActivity ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 font-label-md text-label-md text-secondary">
              {labsSharing > 0 && (
                <span>
                  <span className="text-on-background font-semibold">{labsSharing}</span>{" "}
                  {labsSharing === 1 ? "lab" : "labs"} sharing
                </span>
              )}
              <span>
                <span className="text-on-background font-semibold">{stats.memberCount}</span>{" "}
                {stats.memberCount === 1 ? "member" : "members"}
                {stats.joinedLast7d > 0 && ` (+${stats.joinedLast7d} this week)`}
              </span>
              {newThisWeek > 0 && (
                <span>
                  <span className="text-on-background font-semibold">{newThisWeek}</span> new
                  this week
                </span>
              )}
              <Link href="/collaborate" className="text-primary hover:underline underline-offset-4">
                Clear filters
              </Link>
            </div>
          ) : (
            <p className="mt-4 font-label-md text-label-md text-secondary">
              {posts.length} {posts.length === 1 ? "post" : "posts"} · {resources.length}{" "}
              {resources.length === 1 ? "resource" : "resources"}
              {(filtered || communitySlug) && " matching"}
              {(filtered || communitySlug) && (
                <>
                  {" · "}
                  <Link href="/collaborate" className="text-primary hover:underline underline-offset-4">
                    Clear filters
                  </Link>
                </>
              )}
            </p>
          )}

          {communityId && hasActivity && recentActivity.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-body-sm text-body-sm text-secondary/80">
              {recentActivity.map((item, i) => (
                <li key={i}>
                  <span className="material-symbols-outlined text-sm align-text-bottom mr-0.5">
                    {item.kind === "post" ? "campaign" : "science"}
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Empty community state — intentional, not "no results" */}
      {isEmptyCommunity ? (
        <div className="mt-6 max-w-2xl mx-auto glass-panel rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-primary">groups</span>
          <h2 className="mt-3 font-headline-md text-headline-md text-on-background">
            {community!.name} is just getting started here
          </h2>
          <p className="mt-2 font-body-md text-body-md text-secondary max-w-md mx-auto">
            {community!.description ||
              "This community doesn't have any posts or shared resources yet."}{" "}
            Be the first to add a technique, a piece of equipment, a line — or post
            what you&apos;re looking for.
            {stats.memberCount > 0 &&
              ` ${stats.memberCount} ${stats.memberCount === 1 ? "person has" : "people have"} already joined.`}
          </p>
          {/* Both outline, not one primary + one outline: "Add to the board"
              in the header is already the one primary action on this
              screen — repeating it in solid green here would be a second
              competing green element, not a second primary action. */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href={newResourceHref} className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
              Add what your lab can share
            </Link>
            <Link href={newPostHref} className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
              Create a post
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Board */}
          {posts.length === 0 ? (
            <div className="mt-6 max-w-xl mx-auto">
              <InvitationCard
                heading={filtered ? "Nothing matches that yet" : "Be the first to post"}
                body={
                  filtered
                    ? "Try a broader filter — or post what you're looking for and let the community come to you."
                    : "Invite the community to collaborate on your next breakthrough research project."
                }
                href={newPostHref}
              />
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} signedIn={signedIn} />
              ))}
              <InvitationCard
                heading="Don't see what you need?"
                body="Invite the community to collaborate on your next breakthrough research project."
                href={newPostHref}
              />
            </div>
          )}

          {/* Shared lab resources */}
          <section className="mt-14 pt-8 border-t border-outline-variant/30">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-headline-md text-headline-md text-on-background">
                  Shared lab resources
                </h2>
                <p className="mt-1 font-body-md text-body-md text-secondary">
                  Techniques, equipment, vectors, models, and more that labs have
                  registered for others to use.
                </p>
              </div>
              <Link
                href={newResourceHref}
                className="btn-outline shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-label-md text-label-md"
              >
                <span className="material-symbols-outlined text-base">add</span>
                Add a resource
              </Link>
            </div>

            {resources.length === 0 ? (
              <div className="mt-6 max-w-xl">
                <InvitationCard
                  heading="Nothing registered yet"
                  body="Add a technique, an antibody, a cell line — anything your lab is willing to share."
                  href={newResourceHref}
                  cta="Add a resource"
                />
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {resources.map((r) => (
                  <ResourceCard key={r.id} resource={r} signedIn={signedIn} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <div className="mt-14 pt-8 border-t border-outline-variant/30">
        <InlineFeedback
          prompt="What would make you post here?"
          pagePath="/collaborate"
        />
      </div>
    </div>
  );
}
