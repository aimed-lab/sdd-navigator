// Landing page ("/") — the BioTechX Europe pitch: open source drug discovery,
// an open network where researchers build projects and industry partners with
// them. Uses the shared design tokens (tailwind.config.ts) and the
// .glass-card / .btn-primary / .btn-outline classes from globals.css. Nav +
// Footer come from the root layout.
//
// SERVER component. Two live reads, both degrade to "not shown" on failure:
//   * the 3 newest Industry News headlines, from the explore-mcp landing feed
//     (the same RSS-backed news section Explore's News chip shows);
//   * the podcast episode count, from the same wiki_pages read /explore/podcast
//     uses.
// HONESTY RULE: a number is only rendered when it came from one of those reads
// AND is at least MIN_COUNT_TO_SHOW. Nothing here is a typed-in statistic
// (the one number in the copy, "8 academic projects", is the brief's own text —
// see the Project pipeline card).

import Link from "next/link";
import ItemCard from "@/components/ItemCard";
import Locked from "@/components/Locked";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
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

const STEPS = [
  "Researchers explore, collaborate and promote their work",
  "A network of people and a pipeline of real projects grows",
  "Industry partners with teams and sponsors challenges on hard problems",
] as const;

const COMING = [
  {
    icon: "account_tree",
    title: "Project pipeline",
    body: "8 academic projects from the 2026 SPARC ColaboFest, ready for partners.",
    href: "/communities/colabofest-2026",
  },
  {
    icon: "hub",
    title: "The network",
    body: "Who works on what, from their published work, plus a directory of service providers and CROs.",
  },
  {
    icon: "neurology",
    title: "Foundation models",
    body: "Curated models and datasets, including virtual cell, in a protected space.",
  },
] as const;

const CAPABILITIES = [
  {
    icon: "medical_information",
    title: "OneFlorida+ patient data",
    body: "Real patient records for cohort finding and clinical study design.",
    cta: "Request access",
    href: "/invite",
  },
  {
    icon: "groups",
    title: "Synthetic patients",
    body: "Realistic synthetic patient data when real data can't be shared.",
    cta: "Request access",
    href: "/invite",
  },
  {
    icon: "biotech",
    title: "Network biology tools",
    body: "PAGER, HAPPI, BEERE and the AI.MED lab's informatics tools.",
    cta: "See tools",
    href: "/explore/PAGER",
  },
  {
    icon: "smart_toy",
    title: "Connect your AI",
    body: "Plug your own AI assistant into our drug discovery search through MCP.",
    cta: "Request access",
    href: "/invite",
  },
] as const;

const DARK = "bg-gradient-to-br from-on-primary-fixed to-on-primary-fixed-variant text-white";
const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";

export default async function Home() {
  const [news, episodes] = await Promise.all([getLatestNews(), getEpisodeCount()]);
  const showEpisodes = episodes !== null && episodes >= MIN_COUNT_TO_SHOW;

  return (
    <>
      {/* 1. Hero */}
      <section className={DARK}>
        <div className={`${WRAP} py-20 md:py-32`}>
          <div className="max-w-3xl space-y-6">
            <p className="font-label-md text-label-md uppercase tracking-wide text-primary-fixed-dim">
              Open source drug discovery · UAB SPARC
            </p>
            <h1 className="font-display-lg text-display-lg md:text-[64px] md:leading-[1.1]">
              Open source drug discovery starts here.
            </h1>
            <p className="font-body-lg text-body-lg text-white/85">
              The tools, the data and the people, in one open network. Researchers build projects
              here. Industry brings its hardest problems.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Link
                href="/invite"
                className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg text-center"
              >
                Request invite code
              </Link>
              <Link
                href="/industry"
                className="px-8 py-4 rounded-lg font-label-md text-lg text-center border border-white/60 text-white hover:bg-white/10 transition-colors"
              >
                For industry
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. How it works */}
      <section className={`${WRAP} py-16 md:py-20`}>
        <h2 className="font-headline-lg text-headline-lg text-on-background mb-10">How it works</h2>
        <ol className="flex flex-col md:flex-row md:items-stretch gap-4 md:gap-3">
          {STEPS.map((step, i) => (
            <li key={step} className="contents">
              {i > 0 && (
                <span
                  aria-hidden
                  className="material-symbols-outlined text-primary self-center text-3xl shrink-0 rotate-90 md:rotate-0"
                >
                  arrow_forward
                </span>
              )}
              <div className="glass-panel rounded-xl p-6 flex-1 flex flex-col gap-4">
                <span className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md">
                  {i + 1}
                </span>
                <p className="font-body-lg text-body-lg text-on-background">{step}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 font-label-md text-label-md text-secondary">
          Nonprofit and pre-competitive. Built at UAB SPARC.
        </p>
      </section>

      {/* 3. Choose your path */}
      <section className="bg-surface-container-low">
        <div className={`${WRAP} py-16 md:py-20`}>
          <h2 className="font-headline-lg text-headline-lg text-on-background mb-10">
            Choose your path
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
            <div className="glass-panel rounded-xl p-8 md:p-10 flex flex-col gap-6 bg-white">
              <span className="material-symbols-outlined text-primary text-4xl">science</span>
              <div>
                <h3 className="font-headline-md text-headline-md text-on-background mb-3">
                  For researchers
                </h3>
                <p className="font-body-lg text-body-lg text-secondary">
                  Explore papers, data and tools. Collaborate on projects. Promote your work.
                </p>
              </div>
              <div className="mt-auto flex flex-wrap gap-3 pt-2">
                {[
                  ["Explore", "/explore"],
                  ["Collaborate", "/collaborate"],
                  ["Promote", "/promote"],
                ].map(([label, href]) => (
                  <Link
                    key={href}
                    href={href}
                    className="px-5 py-2 rounded-full bg-primary/10 text-primary font-label-md text-label-md hover:bg-primary/20 transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-xl p-8 md:p-10 flex flex-col gap-6 bg-white">
              <span className="material-symbols-outlined text-primary text-4xl">domain</span>
              <div>
                <h3 className="font-headline-md text-headline-md text-on-background mb-3">
                  For industry
                </h3>
                <p className="font-body-lg text-body-lg text-secondary">
                  See the project pipeline, find expertise, and sponsor challenges.
                </p>
              </div>
              <div className="mt-auto pt-2">
                <Link
                  href="/industry"
                  className="btn-primary inline-block px-6 py-3 rounded-lg font-label-md text-label-md text-center"
                >
                  See what&apos;s here for you
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Updated every day */}
      <section className={`${WRAP} py-16 md:py-20`}>
        <div className="flex items-center justify-between gap-3 mb-8">
          <h2 className="font-headline-lg text-headline-lg text-on-background">Updated every day</h2>
          <Link
            href="/explore"
            className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0"
          >
            Explore everything
          </Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-gutter">
          {news.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
          <div className="glass-panel rounded-xl p-6 flex flex-col gap-4 justify-center">
            <p className="font-label-md text-label-md uppercase tracking-wide text-primary">
              What&apos;s live
            </p>
            {showEpisodes && (
              <div>
                <p className="font-headline-lg text-headline-lg text-on-background leading-none">
                  {episodes}
                </p>
                <p className="font-body-md text-body-md text-secondary mt-1">podcast episodes</p>
              </div>
            )}
            <p className="font-body-md text-body-md text-secondary">
              Live search across papers, datasets, tools, trials and industry news from BioPharma
              Dive, STAT and Endpoints.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Coming into view */}
      <section className="bg-surface-container-low">
        <div className={`${WRAP} py-16 md:py-20`}>
          <h2 className="font-headline-lg text-headline-lg text-on-background mb-2">
            Coming into view
          </h2>
          <p className="font-body-md text-body-md text-secondary mb-10">
            What&apos;s real now, and what unlocks next.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            {COMING.map((c) => (
              <div key={c.title} className="glass-panel rounded-xl p-6 bg-white flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="material-symbols-outlined text-primary text-3xl">{c.icon}</span>
                  <Locked />
                </div>
                <h3 className="font-headline-md text-headline-md text-on-background">{c.title}</h3>
                <p className="font-body-md text-body-md text-secondary">{c.body}</p>
                {"href" in c && (
                  <Link
                    href={c.href}
                    className="mt-auto font-label-md text-label-md text-primary hover:underline underline-offset-4"
                  >
                    See the ColaboFest projects →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. SPARC capabilities */}
      <section className={`${WRAP} py-16 md:py-20`}>
        <h2 className="font-headline-lg text-headline-lg text-on-background mb-10">
          SPARC capabilities
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="glass-card rounded-xl p-6 flex flex-col gap-3">
              <span className="material-symbols-outlined text-primary text-3xl">{c.icon}</span>
              <h3 className="font-headline-md text-lg leading-tight text-on-background">
                {c.title}
              </h3>
              <p className="font-body-md text-body-md text-secondary">{c.body}</p>
              <Link
                href={c.href}
                className="mt-auto pt-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
              >
                {c.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Closing band */}
      <section className={DARK}>
        <div className={`${WRAP} py-16 md:py-20 flex flex-col md:flex-row md:items-center md:justify-between gap-8`}>
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
