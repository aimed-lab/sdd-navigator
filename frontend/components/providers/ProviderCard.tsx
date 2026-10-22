// One provider as a card (directory grid, and "Similar providers"): cover image
// cropped from the top, the event label, category, name, description, then the
// first key fact if there is one, else up to 3 service chips, then the location
// (or "N services") and "View". The whole card is one link. Server-safe.

import Image from "next/image";
import Link from "next/link";
import { cardFooterText, categoryLabel, visibleKeyFacts, type Provider } from "@/lib/server/providers/core";

export default function ProviderCard({ provider: p }: { provider: Provider }) {
  const fact = visibleKeyFacts(p)[0];
  return (
    <Link
      href={`/collaborate/providers/${p.slug}`}
      className="tile group flex flex-col overflow-hidden bg-white shadow-[0_1px_2px_rgba(40,36,28,0.05)]"
    >
      <div className="relative aspect-[4/3] bg-surface-container-low">
        {p.cover && (
          <Image
            src={p.cover}
            alt=""
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover object-top"
          />
        )}
      </div>
      <div className="flex flex-col flex-1 p-4">
        <p className="type-label text-secondary">Met at BioTechX 2026</p>
        <p className="mt-2 font-label-sm text-label-sm text-primary">{categoryLabel(p.category)}</p>
        <h3 className="mt-1 font-title text-[20px] leading-tight font-medium text-on-background">{p.name}</h3>
        <p className="mt-2 font-body-sm text-body-sm text-secondary line-clamp-3">{p.description}</p>

        {fact ? (
          <p className="mt-3 flex items-baseline gap-2">
            <span className="font-title text-[22px] font-medium text-primary">{fact.value}</span>
            <span className="font-body-sm text-body-sm text-secondary">{fact.label}</span>
          </p>
        ) : (
          p.services.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.services.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="px-2.5 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm"
                >
                  {s}
                </span>
              ))}
            </div>
          )
        )}

        <div className="mt-auto pt-4 flex items-center justify-between gap-3 font-label-sm text-label-sm">
          <span className="text-secondary truncate">{cardFooterText(p)}</span>
          <span className="shrink-0 text-primary group-hover:underline underline-offset-4">View →</span>
        </div>
      </div>
    </Link>
  );
}
