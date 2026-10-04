// /industry — the page for pharma and biotech visitors (BioTechX Europe).
// Same look as the homepage: light backgrounds, solid white cards, the shared
// tokens, <Locked>, and the metro-style line from DiscoveryMap for the
// "sponsored challenge" flow. Static server component, no data reads, and no
// numbers beyond the "8 teams" in the brief's own pipeline copy.

import Link from "next/link";
import Locked from "@/components/Locked";
import LockedNetworkCard from "@/components/LockedNetworkCard";

const STEPS = [
  {
    icon: "campaign",
    title: "Post a challenge",
    body: "A target, a disease or a dataset you want cracked.",
    color: "#2563eb",
  },
  {
    icon: "group_add",
    title: "Teams form",
    body: "Academic labs, tools and data matched from the network.",
    color: "#9333ea",
  },
  {
    icon: "monitoring",
    title: "Follow progress",
    body: "See every team's work on your challenge in one place.",
    color: "#ec4899",
  },
] as const;

const CAPABILITIES = [
  {
    icon: "medical_information",
    title: "Patient cohorts",
    body: "Real patient records through OneFlorida+ for cohort finding and trial design.",
    cta: "Request access",
    href: "/invite?interest=cohorts",
  },
  {
    icon: "groups",
    title: "Synthetic patients",
    body: "Realistic synthetic patient data when real data can't be shared.",
    cta: "Request access",
    href: "/invite?interest=synthetic",
  },
  {
    icon: "gavel",
    title: "Patent search",
    locked: true,
  },
  {
    icon: "smart_toy",
    title: "AI access through MCP",
    body: "Connect your own AI tools to our drug discovery search.",
    cta: "Request access",
    href: "/invite?interest=mcp",
  },
] as const;

const DARK = "bg-gradient-to-br from-on-primary-fixed to-on-primary-fixed-variant text-white";
const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";
const CARD = "rounded-2xl bg-white border border-outline-variant/60";

export default function IndustryPage() {
  return (
    <>
      {/* 1. Hero */}
      <section className="bg-gradient-to-b from-white to-surface-container-low">
        <div className={`${WRAP} py-12 md:py-20`}>
          <div className="max-w-3xl mx-auto text-center space-y-4">
            <p className="font-label-md text-label-md uppercase tracking-wide text-primary">
              For industry
            </p>
            <h1 className="font-display-lg text-display-lg md:text-[56px] md:leading-[1.1] text-on-background">
              Bring us your hardest problem.
            </h1>
            <p className="font-body-lg text-body-lg text-secondary">
              Reach academic drug discovery teams early, while ideas are still being shaped.
              Nonprofit and pre-competitive.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <Link
                href="/contact"
                className="btn-primary px-8 py-3 rounded-lg font-label-md text-lg text-center"
              >
                Talk to us about a challenge
              </Link>
              <Link
                href="/invite"
                className="px-8 py-3 rounded-lg font-label-md text-lg text-center border border-primary text-primary hover:bg-primary/10 transition-colors"
              >
                Request invite code
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. How a sponsored challenge works: metro-style flow */}
      <section className={`${WRAP} py-14 md:py-16`}>
        <h2 className="font-headline-lg text-headline-lg text-on-background mb-10 text-center md:text-left">
          How a sponsored challenge works
        </h2>
        <ol className="relative grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6">
          {/* Desktop line, behind the dots. On phones each step draws its own segment downward. */}
          <span
            aria-hidden
            className="hidden md:block absolute top-3 left-[16.67%] right-[16.67%] h-2 rounded-full bg-gradient-to-r from-[#2563eb] via-[#9333ea] to-[#ec4899]"
          />
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative flex md:flex-col items-start md:items-center gap-5">
              {/* Phone: the segment from this dot down to the next one (card height + gap). */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="md:hidden absolute left-3 top-4 w-2 rounded-full"
                  style={{
                    height: "calc(100% + 2rem)",
                    background: `linear-gradient(${step.color}, ${STEPS[i + 1].color})`,
                  }}
                />
              )}
              <span
                aria-hidden
                className="relative z-10 h-8 w-8 shrink-0 rounded-full bg-white border-[6px]"
                style={{ borderColor: step.color }}
              />
              <div className={`${CARD} flex-1 w-full p-6 md:p-8 flex flex-col gap-4 md:items-center md:text-center`}>
                <span
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ background: `${step.color}1a` }}
                >
                  <span className="material-symbols-outlined text-3xl" style={{ color: step.color }}>
                    {step.icon}
                  </span>
                </span>
                <h3 className="font-headline-md text-headline-md text-on-background">
                  {step.title}
                </h3>
                <p className="font-body-lg text-body-lg text-secondary">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 3. The project pipeline */}
      <section className="bg-surface-container-low">
        <div className={`${WRAP} py-14 md:py-16`}>
          <div className={`${CARD} p-6 md:p-10 flex flex-col md:flex-row md:items-center gap-6 md:gap-10`}>
            <span className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary text-4xl">account_tree</span>
            </span>
            <div className="flex-1 space-y-3">
              <h2 className="font-headline-lg text-headline-lg text-on-background">
                The project pipeline
              </h2>
              <p className="font-body-lg text-body-lg text-secondary">
                Academic projects ready for partners, starting with the 8 teams from the 2026 SPARC
                ColaboFest.
              </p>
              <p className="flex flex-wrap items-center gap-2 font-body-md text-body-md text-secondary">
                <Locked />
                Abstracts are open. Full proposals unlock with an invite code.
              </p>
            </div>
            <Link
              href="/communities/colabofest-2026"
              className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md text-center md:shrink-0"
            >
              See the ColaboFest projects
            </Link>
          </div>
        </div>
      </section>

      {/* 4. The network */}
      <section className={`${WRAP} py-14 md:py-16`}>
        <LockedNetworkCard />
        <p className="mt-4 text-center font-body-md text-body-md text-secondary">
          Are you a vendor or CRO?{" "}
          <Link
            href="/contact"
            className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            Claim your listing
          </Link>
        </p>
      </section>

      {/* 5. Capabilities */}
      <section className="bg-surface-container-low">
        <div className={`${WRAP} py-14 md:py-16`}>
          <h2 className="font-headline-lg text-headline-lg text-on-background mb-10">
            Capabilities you won&apos;t find at a vendor
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className={`${CARD} p-6 flex flex-col gap-3`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-3xl">{c.icon}</span>
                  </span>
                  {"locked" in c && <Locked />}
                </div>
                <h3 className="font-headline-md text-lg leading-tight text-on-background">
                  {c.title}
                </h3>
                {"locked" in c ? (
                  <p className="font-body-md text-body-md text-secondary">Coming soon</p>
                ) : (
                  <>
                    <p className="font-body-md text-body-md text-secondary">{c.body}</p>
                    <Link
                      href={c.href}
                      className="mt-auto pt-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                    >
                      {c.cta} →
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Closing band */}
      <section className={DARK}>
        <div
          className={`${WRAP} py-16 md:py-20 flex flex-col md:flex-row md:items-center md:justify-between gap-8`}
        >
          <h2 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight">
            Let&apos;s talk about your challenge.
          </h2>
          <Link
            href="/contact"
            className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg text-center md:shrink-0"
          >
            Contact us
          </Link>
        </div>
      </section>
    </>
  );
}
