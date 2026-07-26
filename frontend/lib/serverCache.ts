// lib/serverCache.ts — server-side async cache with single-flight.
//
// A TypeScript port of the contract in backend/explore-mcp/cache.py, so the two
// halves of the platform cache the same way. Same three states, same
// single-flight guarantee, same Redis swap point. (It is a port, not a shared
// module — that one is Python and unreachable from Next.)
//
//   FRESH (age < ttl)                -> return cached value, no upstream call.
//   STALE (ttl <= age < staleTtl)    -> return cached value immediately and
//                                       refresh once in the background.
//   MISS  (absent / past staleTtl)   -> compute. SINGLE-FLIGHT: N concurrent
//                                       callers for one missing key run
//                                       compute() ONCE; the rest await it.
//
// Single-flight is the load-bearing part here. The Promote generator spends
// ~6,144 of Groq's 12,000-tokens-per-minute budget per request, so two
// simultaneous requests for the same paper would otherwise burn the budget
// twice for an identical answer.
//
// REDIS SWAP POINT — `Cache` is the interface; `InProcessCache` implements the
// two storage primitives. Policy lives in getOrCompute() and needs no change, so
// a RedisCache only has to implement load/store. NOTE: the single-flight lock
// here is per-process; multi-instance would need a short distributed lock.

type Entry<T> = { value: T; storedAt: number; ttl: number; staleTtl: number };

/** Normalized cache key: lowercased, whitespace-collapsed, sorted terms, joined
 *  with "|" — the same scheme as cache.py's normalize_key (itself a port of
 *  discovery.ts:211). `namespace` keeps unrelated callers from colliding. */
export function normalizeKey(namespace: string, terms: string | string[]): string {
  const parts = (Array.isArray(terms) ? terms : [terms])
    .flatMap((t) => String(t).split(/\s+/))
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return `${namespace}:${parts.join("|")}`;
}

export type CacheStats = {
  hits: number;
  staleHits: number;
  misses: number;
  coalesced: number;
  errors: number;
};

export abstract class Cache {
  stats: CacheStats = { hits: 0, staleHits: 0, misses: 0, coalesced: 0, errors: 0 };

  /** In-flight computes, keyed by cache key — the single-flight primitive. */
  protected inflight = new Map<string, Promise<unknown>>();

  protected abstract load<T>(key: string): Promise<Entry<T> | undefined>;
  protected abstract store<T>(key: string, entry: Entry<T>): Promise<void>;
  abstract clear(): Promise<void>;

  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    ttlMs: number,
    staleTtlMs: number = ttlMs
  ): Promise<T> {
    const now = Date.now();
    const entry = await this.load<T>(key);

    if (entry) {
      const age = now - entry.storedAt;
      if (age < entry.ttl) {
        this.stats.hits++;
        return entry.value;
      }
      if (age < entry.staleTtl) {
        this.stats.staleHits++;
        // Serve stale, refresh behind. Errors are swallowed: the stale value
        // stays valid until staleTtl and the next caller retries.
        if (!this.inflight.has(key)) {
          const p = compute()
            .then(async (value) => {
              await this.store(key, { value, storedAt: Date.now(), ttl: ttlMs, staleTtl: staleTtlMs });
              return value;
            })
            .catch(() => {
              this.stats.errors++;
              return entry.value;
            })
            .finally(() => this.inflight.delete(key));
          this.inflight.set(key, p);
        }
        return entry.value;
      }
    }

    // MISS — single-flight. Registering the promise BEFORE awaiting is what
    // makes concurrent callers coalesce: there is no await between the has()
    // check and the set(), so it is atomic for the event loop.
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.stats.coalesced++;
      return existing;
    }

    this.stats.misses++;
    const p = compute()
      .then(async (value) => {
        await this.store(key, { value, storedAt: Date.now(), ttl: ttlMs, staleTtl: staleTtlMs });
        return value;
      })
      .catch((e) => {
        this.stats.errors++;
        throw e; // a failed compute must NOT be cached
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, p);
    return p;
  }

  /** Whether a key currently has a usable (fresh or stale) value. For tests and
   *  diagnostics — never part of the read path. */
  async has(key: string): Promise<boolean> {
    const e = await this.load(key);
    return !!e && Date.now() - e.storedAt < e.staleTtl;
  }
}

export class InProcessCache extends Cache {
  private data = new Map<string, Entry<unknown>>();

  protected async load<T>(key: string): Promise<Entry<T> | undefined> {
    return this.data.get(key) as Entry<T> | undefined;
  }

  protected async store<T>(key: string, entry: Entry<T>): Promise<void> {
    this.data.set(key, entry as Entry<unknown>);
  }

  async clear(): Promise<void> {
    this.data.clear();
    this.inflight.clear();
    this.stats = { hits: 0, staleHits: 0, misses: 0, coalesced: 0, errors: 0 };
  }

  get size(): number {
    return this.data.size;
  }
}

// ── TTLs ─────────────────────────────────────────────────────────────────────

// Generator output for a given paper barely changes — same abstract in, same
// kind of drafts out — and each miss costs ~6,144 Groq tokens. So the fresh
// window is long and the stale window longer still: an expired entry is served
// instantly while one background refresh runs, which means a popular paper never
// makes a user wait on Groq.
export const TTL_GENERATOR = 24 * 60 * 60 * 1000;        // 24h fresh
export const STALE_TTL_GENERATOR = 7 * 24 * 60 * 60 * 1000; // 7d serve-stale

// Module singleton — swap for `new RedisCache(...)` to go multi-instance.
export const serverCache: Cache = new InProcessCache();
