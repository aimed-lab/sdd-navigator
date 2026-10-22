// Service Providers directory: the typed loader for lib/data/providers.json.
// The JSON is read as is (never edited); this only checks its shape and hands
// back typed records, so a bad entry fails loudly instead of rendering blank.

import raw from "../../data/providers.json" with { type: "json" };
import type { KeyFact, Provider } from "./core.ts";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Check one raw entry; throws naming the slug when something required is off. */
export function parseProvider(r: unknown): Provider {
  const o = (r ?? {}) as Record<string, unknown>;
  const slug = str(o.slug).trim();
  const name = str(o.name).trim();
  if (!slug || !name) throw new Error(`providers.json: an entry has no slug or name (${slug || name || "?"})`);
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`providers.json: bad slug "${slug}"`);
  const facts: KeyFact[] = Array.isArray(o.key_facts)
    ? o.key_facts.map((f) => ({
        value: str((f as Record<string, unknown>)?.value),
        label: str((f as Record<string, unknown>)?.label),
      }))
    : [];
  return {
    slug,
    name,
    category: str(o.category),
    services: strings(o.services),
    description: str(o.description),
    website: str(o.website),
    email: str(o.email),
    phone: str(o.phone),
    location: str(o.location),
    event: str(o.event),
    key_facts: facts,
    key_facts_source: str(o.key_facts_source),
    cover: str(o.cover),
    brochure_pages: strings(o.brochure_pages),
  };
}

/** Parse a whole list; slugs must be unique. */
export function parseProviders(list: unknown): Provider[] {
  if (!Array.isArray(list)) throw new Error("providers.json: expected a list");
  const out = list.map(parseProvider);
  const seen = new Set<string>();
  for (const p of out) {
    if (seen.has(p.slug)) throw new Error(`providers.json: duplicate slug "${p.slug}"`);
    seen.add(p.slug);
  }
  return out;
}

let cache: Provider[] | null = null;

export function getAllProviders(): Provider[] {
  if (!cache) cache = parseProviders(raw);
  return cache;
}

/** The provider with this slug, or null (the page answers 404). */
export function getProviderBySlug(slug: string): Provider | null {
  return getAllProviders().find((p) => p.slug === slug) ?? null;
}

export function providerSlugs(): string[] {
  return getAllProviders().map((p) => p.slug);
}
