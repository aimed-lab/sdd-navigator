// Landing page ("/") — layout follows
// design/stitch/smartdrugdiscovery_landing_page/code.html, using the shared
// design tokens (tailwind.config.ts) and the .glass-card / .btn-primary /
// .btn-outline component classes from globals.css. Nav + Footer come from the
// root layout, which also owns the pt-16 offset for the fixed nav.
//
// Server component on purpose: the only interaction is the "Learn about
// Collabofest" anchor, which relies on `scroll-behavior: smooth` in globals.css.

import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";
import CollabofestFeedbackForm from "@/components/feedback/CollabofestFeedbackForm";
// Static import so Next derives the intrinsic size (1103x1426 portrait) itself.
import collabofestGraphic from "../public/colabofest-2026.avif";

const COLLABOFEST = {
  register: "https://uab.co1.qualtrics.com/jfe/form/SV_cVnlmrmShnzME86",
  infoSession: "https://uab.zoom.us/meeting/register/vd8u1awQQ6Kqfa7d-oXoEg#/",
  details: "https://2026collabofest.ubrite.org/",
  announcement:
    "https://www.smartdrugdiscovery.org/post/dd-collabofest-challenge",
} as const;

// The 3-page proposal outline, per the official SPARC announcement.
const PROPOSAL_POINTS = [
  "A new target",
  "Scientific rationale",
  "SPARC support needed",
  "A plan for wet-lab validation",
] as const;

const KEY_DATES = [
  { label: "Info Session", value: "July 30, 2026 · 10:00 AM CT · Zoom" },
  { label: "Submission deadline", value: "September 30, 2026" },
] as const;

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

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center text-center px-margin-mobile md:px-margin-desktop py-24 md:py-32 overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-primary-fixed/20 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto space-y-8">
          <h1 className="font-display-lg text-display-lg md:text-[64px] md:leading-[1.1] text-on-background">
            Explore. Collaborate. Promote.
          </h1>
          <p className="font-body-lg text-body-lg text-secondary max-w-2xl mx-auto">
            One place to discover research, connect with labs, and share your
            work — for the drug discovery community.
          </p>
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/explore"
              className="btn-primary px-8 py-4 rounded-lg font-label-md text-lg w-full md:w-auto text-center"
            >
              Start Exploring
            </Link>
            <a
              href="#collabofest"
              className="btn-outline px-8 py-4 rounded-lg font-label-md text-lg w-full md:w-auto text-center bg-white/50"
            >
              Learn about Collabofest
            </a>
          </div>
        </div>
      </section>

      {/* Three pillars */}
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

      {/* Collabofest */}
      <section
        id="collabofest"
        className="scroll-mt-16 px-margin-mobile md:px-margin-desktop py-20 md:py-24 bg-surface-container-low"
      >
        {/* The content column runs much taller than the graphic, so the grid is
            top-aligned (align-self:start is also what lets the image cell stick
            within its full-height grid area) and the graphic tracks the reader
            down the content column on desktop. */}
        <div className="max-w-container-max mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Image first in the DOM so mobile stacks it above the content */}
          <div className="glass-panel rounded-xl p-3 sm:p-4 w-full max-w-lg mx-auto lg:max-w-none lg:mx-0 lg:sticky lg:top-20">
            <Image
              src={collabofestGraphic}
              alt="2026 SPARC Drug Discovery Collabofest Challenge"
              // Turbopack has no AVIF support, so it emits this asset without
              // processing and the static import carries no real dimensions
              // (it falls back to 100x100). Passing the true intrinsic size
              // reserves the right aspect-ratio box and avoids layout shift.
              // Converting the asset to PNG/WebP would remove the need for this.
              width={1103}
              height={1426}
              // Fills the column on desktop, but the viewport-relative max-height
              // keeps this portrait graphic shorter than the screen — a sticky
              // element taller than the viewport can never scroll to its bottom.
              // w-auto + max-w-full + max-h lets the browser scale it down while
              // preserving the aspect ratio.
              className="w-full h-auto rounded-lg lg:w-auto lg:mx-auto lg:max-w-full lg:max-h-[calc(100vh-9rem)]"
              sizes="(min-width: 1024px) 40rem, (min-width: 640px) 32rem, 100vw"
              priority
            />
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <h2 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
                2026 SPARC Drug Discovery Collabofest Challenge
              </h2>
              <p className="font-body-lg text-body-lg text-secondary">
                Move promising drug-discovery projects from computational
                discovery to experimental validation. Submission deadline:
                September 30, 2026.
              </p>
            </div>

            {/* What teams submit */}
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <h3 className="font-headline-md text-headline-md text-on-background">
                What teams submit
              </h3>
              <p className="font-body-md text-body-md text-secondary">
                UAB teams submit a short 3-page proposal describing:
              </p>
              <ul className="space-y-2">
                {PROPOSAL_POINTS.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 font-body-md text-body-md text-on-background"
                  >
                    <span className="material-symbols-outlined text-primary text-xl shrink-0">
                      check_circle
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* Why it matters */}
            <div className="space-y-2">
              <h3 className="font-label-sm text-label-sm text-primary uppercase">
                Why it matters
              </h3>
              <p className="font-body-md text-body-md text-secondary">
                The goal is to help promising projects move from computational
                discovery to experimental validation — creating new
                collaborations, generating pilot data, and supporting future
                grants and publications, while positioning SPARC as a central hub
                for drug discovery innovation at UAB.
              </p>
            </div>

            {/* Key dates */}
            <div className="glass-panel rounded-xl p-6 space-y-4">
              <h3 className="font-label-sm text-label-sm text-primary uppercase">
                Key dates
              </h3>
              <ol className="space-y-4">
                {KEY_DATES.map((d, i) => (
                  <li key={d.label} className="flex gap-4">
                    {/* Dot + connector rail */}
                    <div className="flex flex-col items-center pt-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                      {i < KEY_DATES.length - 1 && (
                        <span className="w-px flex-1 bg-outline-variant mt-1" />
                      )}
                    </div>
                    <div className="pb-1">
                      <p className="font-label-md text-label-md text-on-background font-semibold">
                        {d.label}
                      </p>
                      <p className="font-body-sm text-body-sm text-secondary">
                        {d.value}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <a
                href={COLLABOFEST.register}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-block px-8 py-4 rounded-lg font-label-md text-lg"
              >
                Register Now
              </a>
            </div>

            {/* Info-session callout */}
            <div className="glass-panel rounded-xl p-6 border-l-4 border-l-primary">
              <p className="flex items-start gap-3 font-body-md text-body-md text-on-background">
                <span className="material-symbols-outlined text-primary shrink-0">
                  videocam
                </span>
                <span>
                  <span className="font-semibold">Virtual Information Session</span>{" "}
                  — July 30, 2026 · 10:00 AM CT · via Zoom
                </span>
              </p>
              <a
                href={COLLABOFEST.infoSession}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 font-label-md text-label-md text-primary hover:underline underline-offset-4"
              >
                Register for the Info Session
              </a>
            </div>

            <div className="flex flex-col gap-2">
              <a
                href={COLLABOFEST.details}
                target="_blank"
                rel="noopener noreferrer"
                className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
              >
                Full details, eligibility &amp; review criteria →
              </a>
              <a
                href={COLLABOFEST.announcement}
                target="_blank"
                rel="noopener noreferrer"
                className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
              >
                Read the full announcement →
              </a>
            </div>

            <p className="font-body-sm text-body-sm text-secondary">
              Questions? Contact Dr. Swathi Thaker (
              <a
                href="mailto:snthaker@uab.edu"
                className="text-primary hover:underline underline-offset-4"
              >
                snthaker@uab.edu
              </a>
              )
            </p>

            <CollabofestFeedbackForm />
          </div>
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
