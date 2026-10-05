// Landing page ("/") — the BioTechX Europe pitch: open source drug discovery,
// an open network where researchers build projects. The hero presents the hub
// and its three functions (Explore, Collaborate, Promote, same words as the nav). PHGDH in Alzheimer's is the worked example:
// the coral route on the clickable DiscoveryMap plus the grouped step list under
// it; its links all live in lib/phgdhRoute.ts. Uses the shared design
// tokens (tailwind.config.ts) and the .btn-primary class from globals.css. Nav
// + Footer come from the root layout.
//
// No reveal-on-scroll animation, and no backdrop-filter on cards (glass cards
// rendered blank on phones until scrolled past): everything is visible on first
// paint. The news row uses the same tinted tiles as Explore (NewsTile).
//
// SERVER component. Two live reads, both degrade to "not shown" on failure:
//   * 3 Industry News headlines (non-political, most relevant then newest), from the explore-mcp landing feed
//     (the same RSS-backed news section Explore's News chip shows);
//   * the podcast episode count, from the same wiki_pages read /explore/podcast
//     uses.
// HONESTY RULE: a number is only rendered when it came from one of those reads
// AND is at least MIN_COUNT_TO_SHOW. Nothing here is a typed-in statistic.

import Link from "next/link";
import DiscoveryMap from "@/components/DiscoveryMap";
import PhgdhRouteList from "@/components/PhgdhRouteList";
import NewsTile from "@/components/explore/NewsTile";
import { rankNews } from "@/lib/newsLead";
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
    // Not just the newest three: drop political headlines and rank the rest by
    // drug-discovery relevance, then recency (lib/newsLead.ts).
    return rankNews(news?.items ?? [], 3);
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



const DARK = "bg-gradient-to-br from-on-primary-fixed to-on-primary-fixed-variant text-white";
const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";

export default async function Home() {
  const [news, episodes] = await Promise.all([getLatestNews(), getEpisodeCount()]);
  const showEpisodes = episodes !== null && episodes >= MIN_COUNT_TO_SHOW;

  return (
    <>
      {/* a. Hero: the hub and its three functions */}
      <section className="bg-[var(--explore-bg)]">
        <div className={`${WRAP} pt-12 md:pt-16 pb-10 md:pb-12`}>
          <div className="max-w-4xl mx-auto text-center space-y-4">
            <h1 className="font-title text-[40px] md:text-[56px] leading-[1.1] font-medium text-on-background">
              Explore. Collaborate. Promote.{" "}
              <br className="hidden sm:block" />
              Open drug discovery in one hub.
            </h1>
            <p className="font-body-lg text-body-lg text-secondary">
              Papers, data, tools and people in one place. See how it works with a real case:
              PHGDH in Alzheimer&apos;s, from first papers to an open patent pilot.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <Link
                href="/explore"
                className="btn-primary px-8 py-3 rounded-lg font-label-md text-lg text-center"
              >
                Start exploring →
              </Link>
              <a
                href="#phgdh-route"
                className="px-8 py-3 rounded-lg font-label-md text-lg text-center border border-primary text-primary hover:bg-primary/10 transition-colors"
              >
                Follow the PHGDH case ↓
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* a2. How it works: the PHGDH case, on the map */}
      <section id="phgdh-route" className="bg-[var(--explore-bg)] scroll-mt-16">
        <div className={`${WRAP} pb-12 md:pb-16`}>
          <div className="max-w-3xl mx-auto text-center mb-4">
            <h2 className="font-title text-[28px] md:text-[30px] leading-tight font-medium text-on-background">
              How it works: the PHGDH case
            </h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">
              Every line runs through the hub. The coral line is one real journey: PHGDH.
            </p>
          </div>
          <DiscoveryMap />
          <PhgdhRouteList />
        </div>
      </section>

      {/* b. Explore on your own */}
      <section className="bg-[var(--explore-bg)]">
        <div className={`${WRAP} py-14 md:py-16 border-t border-[#e7e4dc]`}>
          <div className="flex items-end justify-between gap-3 mb-6">
            <h2 className="font-title text-[28px] leading-tight font-medium text-on-background">
              Explore on your own
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

      {/* c. One call to action */}
      <section>
        <div className={`${WRAP} py-14 md:py-16 flex justify-center`}>
          <Link
            href="/explore"
            className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg text-center"
          >
            Start exploring →
          </Link>
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
            Have a target in mind? Start exploring.
          </h2>
          <Link
            href="/explore"
            className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg text-center md:shrink-0"
          >
            Start exploring →
          </Link>
        </div>
      </section>
    </>
  );
}
