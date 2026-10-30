// One service provider — /collaborate/providers/[slug].
//
// A green hero with the cover, the category and event tags, name, description
// and service chips. The key-facts strip overlaps the hero ONLY when the
// provider has key facts (with the source line under it). Then "Their
// brochure" (thumbnails + lightbox). The sidebar has the tracked Visit website
// button, Request a quote, email/phone when present, similar providers and
// "Claim this page".
//
// Each render logs one profile_view (server side; user id only when signed in).

import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import BrochureViewer from "@/components/providers/BrochureViewer";
import { ClaimButton, QuoteButton } from "@/components/providers/ProviderForms";
import { getCurrentUser } from "@/lib/auth";
import {
  categoryLabel,
  referrerPath,
  similarProviders,
  trackedWebsiteUrl,
  visibleKeyFacts,
} from "@/lib/server/providers/core";
import { getAllProviders, getProviderBySlug, providerSlugs } from "@/lib/server/providers/providers";
import { logProviderEvent } from "@/lib/server/providers/store";

export const dynamic = "force-dynamic"; // logs a view and reads the session

export function generateStaticParams() {
  return providerSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = getProviderBySlug(slug);
  if (!p) return { title: "Provider not found | SmartDrugDiscovery" };
  const description = p.description.length > 160 ? `${p.description.slice(0, 157).trimEnd()}...` : p.description;
  return {
    title: `${p.name}: ${categoryLabel(p.category)} | SmartDrugDiscovery`,
    description,
    openGraph: { title: p.name, description },
  };
}

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = getProviderBySlug(slug);
  if (!p) notFound();

  const [user, h] = await Promise.all([getCurrentUser(), headers()]);
  await logProviderEvent(p.slug, "profile_view", referrerPath(h.get("referer")));

  const facts = visibleKeyFacts(p);
  const similar = similarProviders(getAllProviders(), p, 3);
  const hasWebsite = trackedWebsiteUrl(p) !== null;
  const signedIn = user !== null;

  return (
    <div className="bg-[var(--explore-bg)] min-h-[calc(100vh-4rem)] pb-24">
      {/* Hero */}
      <section
        className={"text-white " + (facts.length > 0 ? "pb-24" : "pb-12")}
        style={{ backgroundImage: "linear-gradient(135deg, #033319 0%, #1A5632 100%)" }}
      >
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-8">
          <Link
            href="/collaborate/providers"
            className="inline-flex items-center gap-1 font-label-md text-label-md text-white/80 hover:text-white"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            All providers
          </Link>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8 items-center">
            <div>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full bg-white/20 font-label-sm text-label-sm">
                  {categoryLabel(p.category)}
                </span>
                <span className="px-3 py-1 rounded-full bg-white/20 font-label-sm text-label-sm">
                  Met at BioTechX Europe 2026
                </span>
              </div>
              <h1 className="mt-4 font-title text-[34px] md:text-[48px] leading-[1.1] font-medium">{p.name}</h1>
              <p className="mt-4 font-body-lg text-body-lg text-white/90 max-w-2xl">{p.description}</p>
              {p.services.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {p.services.map((s) => (
                    <span key={s} className="px-3 py-1 rounded-full bg-white/15 font-label-sm text-label-sm">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {p.cover && (
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-white shadow-xl">
                <Image
                  src={p.cover}
                  alt={`${p.name} brochure cover`}
                  fill
                  priority
                  sizes="(min-width: 768px) 40vw, 100vw"
                  className="object-cover object-top"
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
        {/* Key facts: only when the provider has some */}
        {facts.length > 0 && (
          <div className="-mt-12 relative rounded-2xl bg-white shadow-[0_8px_24px_rgba(40,36,28,0.1)] p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:divide-x divide-outline-variant/40">
              {facts.map((f, i) => (
                <div key={f.label} className={i === 0 ? "" : "sm:pl-6"}>
                  <dt className="font-label-sm text-label-sm text-secondary uppercase">{f.label}</dt>
                  <dd className="mt-1 font-title text-[32px] leading-none font-medium text-primary">{f.value}</dd>
                </div>
              ))}
            </dl>
            {p.key_facts_source && <p className="mt-4 text-sm text-secondary/80">{p.key_facts_source}</p>}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10 items-start">
          <section aria-labelledby="brochure-heading">
            <h2 id="brochure-heading" className="font-title text-[26px] font-medium text-on-background">
              Their brochure
            </h2>
            <p className="mt-1 mb-5 font-body-md text-body-md text-secondary">
              From {p.name}&apos;s own BioTechX Europe 2026 brochure. Click a page to read it full size.
            </p>
            <BrochureViewer pages={p.brochure_pages} company={p.name} />
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5 space-y-3">
              {hasWebsite && (
                <a
                  href={`/api/providers/${p.slug}/go`}
                  target="_blank"
                  rel="noopener"
                  className="btn-primary w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-label-md text-label-md"
                >
                  Visit website
                  <span className="material-symbols-outlined text-base">arrow_outward</span>
                </a>
              )}
              <QuoteButton slug={p.slug} company={p.name} signedIn={signedIn} />
              {(p.email || p.phone) && (
                <div className="pt-2 space-y-1 font-body-md text-body-md">
                  {p.email && (
                    <p>
                      <a href={`mailto:${p.email}`} className="text-primary hover:underline underline-offset-4 break-all">
                        {p.email}
                      </a>
                    </p>
                  )}
                  {p.phone && (
                    <p>
                      <a href={`tel:${p.phone.replace(/[^+\d]/g, "")}`} className="text-primary hover:underline underline-offset-4">
                        {p.phone}
                      </a>
                    </p>
                  )}
                </div>
              )}
            </section>

            {similar.length > 0 && (
              <section>
                <h2 className="font-title text-[20px] font-medium text-on-background mb-3">Similar providers</h2>
                <div className="space-y-3">
                  {similar.map((s) => (
                    <Link
                      key={s.slug}
                      href={`/collaborate/providers/${s.slug}`}
                      className="tile block bg-white p-4 shadow-[0_1px_2px_rgba(40,36,28,0.05)]"
                    >
                      <p className="font-label-sm text-label-sm text-primary">{categoryLabel(s.category)}</p>
                      <p className="mt-0.5 font-title text-[18px] font-medium text-on-background">{s.name}</p>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl bg-surface-container-low p-5">
              <h2 className="font-label-md text-label-md text-on-background">Is this your company?</h2>
              <div className="mt-2">
                <ClaimButton slug={p.slug} company={p.name} signedIn={signedIn} />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
