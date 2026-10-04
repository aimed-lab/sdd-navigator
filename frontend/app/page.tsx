// Landing page ("/") — the BioTechX Europe pitch: open source drug discovery,
// an open network where researchers build projects and industry partners with
// them. The hero is the PHGDH-in-Alzheimer's case study (Prof. Chen's Basel
// talk), drawn as a route on the clickable DiscoveryMap; its links all live in
// lib/phgdhRoute.ts. Uses the shared design
// tokens (tailwind.config.ts) and the .btn-primary class from globals.css. Nav
// + Footer come from the root layout.
//
// No reveal-on-scroll animation, and no backdrop-filter on cards (glass cards
// rendered blank on phones until scrolled past): everything is visible on first
// paint. The news row uses the same tinted tiles as Explore (NewsTile).
//
// SERVER component. Two live reads, both degrade to "not shown" on failure:
//   * the 3 newest Industry News headlines, from the explore-mcp landing feed
//     (the same RSS-backed news section Explore's News chip shows);
//   * the podcast episode count, from the same wiki_pages read /explore/podcast
//     uses.
// HONESTY RULE: a number is only rendered when it came from one of those reads
// AND is at least MIN_COUNT_TO_SHOW. Nothing here is a typed-in statistic.

import Link from "next/link";
import DiscoveryMap from "@/components/DiscoveryMap";
import PhgdhRouteList from "@/components/PhgdhRouteList";
import { PHGDH_LINKS } from "@/lib/phgdhRoute";
import NewsTile from "@/components/explore/NewsTile";
import LockedNetworkCard from "@/components/LockedNetworkCard";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { TYPE_STYLES } from "@/lib/typeStyles";
import { listEpisodes } from "@/lib/server/wiki";
import type { ExploreItem, ExploreResponse } from "@/types/explore";

const MIN_COUNT_TO_SHOW = 10;

async function getLatestNews(): Promise<ExploreItem[]> {
  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/explore`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ input: "" }),
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as ExploreResponse;
    const news = (data.sections ?? []).find((s) => s.kind === "news");
    return (news?.items ?? []).slice(0, 3);
  } catch (e) {
    console.error("Home: news fetch failed", e);
    return [];
  }
}

async function getEpisodeCount(): Promise<number | null> {
  try {
    const result = await listEpisodes();
    return result.status === "ok" ? result.episodes.length : null;
  } catch {
    return null;
  }
}

const AUDIENCES = [
  {
    icon: "science",
    title: "I'm a researcher",
    body: "Explore, collaborate and promote your work.",
    cta: "Start exploring",
    href: "/explore",
  },
  {
    icon: "domain",
    title: "I'm from industry",
    body: "See the project pipeline, find expertise, sponsor challenges.",
    cta: "See what's here for you",
    href: "/industry",
  },
] as const;


const DARK = "bg-gradient-to-br from-on-primary-fixed to-on-primary-fixed-variant text-white";
const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";

export default async function Home() {
  const [news, episodes] = await Promise.all([getLatestNews(), getEpisodeCount()]);
  const showEpisodes = episodes !== null && episodes >= MIN_COUNT_TO_SHOW;

  return (
    <>
      {/* a. Hero: the PHGDH case study, drawn as a route on the map */}
      <section className="bg-[var(--explore-bg)]">
        <div className={`${WRAP} pt-12 md:pt-16 pb-12 md:pb-16`}>
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <p className="font-label-md text-label-md uppercase tracking-wide text-[#C2410C]">
              Case study · PHGDH in Alzheimer&apos;s
            </p>
            <h1 className="font-title text-[40px] md:text-[56px] leading-[1.1] font-medium text-on-background">
              From paper to patent, in the open.
            </h1>
            <p className="font-body-lg text-body-lg text-secondary">
              Follow PHGDH from the first Alzheimer&apos;s papers to an open patent pilot, all
              through one hub.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <a
                href={PHGDH_LINKS.join}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary px-8 py-3 rounded-lg font-label-md text-lg text-center"
              >
                Join the PHGDH call ↗
              </a>
              <Link
                href="/explore"
                className="px-8 py-3 rounded-lg font-label-md text-lg text-center border border-primary text-primary hover:bg-primary/10 transition-colors"
              >
                Explore on your own →
              </Link>
            </div>
          </div>
          <div className="mt-10">
            <DiscoveryMap />
          </div>
          <PhgdhRouteList />
        </div>
      </section>

      {/* b. Not here for PHGDH? Start exploring */}
      <section className="bg-[var(--explore-bg)]">
        <div className={`${WRAP} py-14 md:py-16 border-t border-[#e7e4dc]`}>
          <div className="flex items-end justify-between gap-3 mb-6">
            <h2 className="font-title text-[28px] leading-tight font-medium text-on-background">
              Not here for PHGDH? Start exploring
            </h2>
            <Link
              href="/explore"
              className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0 pb-1"
            >
              Open Explore →
            </Link>
          </div>
          {(news.length > 0 || showEpisodes) && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-gutter items-stretch">
              {news.map((item) => (
                <NewsTile key={item.id} item={item} />
              ))}
              {showEpisodes && (
                <Link
                  href="/explore/podcast"
                  className="tile flex flex-col justify-center gap-1 p-6"
                  style={{ background: TYPE_STYLES.podcast.bg }}
                >
                  <p className="type-label" style={{ color: TYPE_STYLES.podcast.fg }}>
                    Podcast
                  </p>
                  <p className="mt-2 font-title text-[44px] leading-none font-medium text-on-background">
                    {episodes}
                  </p>
                  <p className="font-body-md text-body-md text-on-background/70">episodes</p>
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {/* c. Two audiences */}
      <section className="bg-surface-container-low">
        <div className={`${WRAP} py-14 md:py-16`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
            {AUDIENCES.map((c) => (
              <div
                key={c.title}
                className="rounded-2xl bg-white border border-outline-variant/60 p-8 md:p-10 flex flex-col gap-5"
              >
                <span className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-4xl">{c.icon}</span>
                </span>
                <div>
                  <h3 className="font-headline-md text-headline-md text-on-background mb-2">
                    {c.title}
                  </h3>
                  <p className="font-body-lg text-body-lg text-secondary">{c.body}</p>
                </div>
                <div className="mt-auto pt-2">
                  <Link
                    href={c.href}
                    className="btn-primary inline-block px-6 py-3 rounded-lg font-label-md text-label-md text-center"
                  >
                    {c.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* d. Locked network preview: placeholder bars only, no names */}
      <section className={`${WRAP} py-14 md:py-16`}>
        <LockedNetworkCard />
      </section>

      {/* e. Closing band */}
      <section className={DARK}>
        <div
          className={`${WRAP} py-16 md:py-20 flex flex-col md:flex-row md:items-center md:justify-between gap-8`}
        >
          <h2 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight">
            Bring us your hardest problem.
          </h2>
          <Link
            href="/industry"
            className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg text-center md:shrink-0"
          >
            For industry
          </Link>
        </div>
      </section>
    </>
  );
}
