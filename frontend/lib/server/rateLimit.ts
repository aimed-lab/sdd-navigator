// Tiny in-memory sliding-window rate limiter. The state lives in this
// process's memory, so it is best-effort protection against casual abuse, not
// a guarantee across server instances. No runtime imports.

export type RateLimiter = {
  /** Records a hit for `key` and returns true when it is over the limit. */
  limited(key: string, now?: number): boolean;
};

export function createRateLimiter(windowMs: number, max: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    limited(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return true;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) {
        hits.forEach((times, k) => {
          if (times.every((t) => now - t >= windowMs)) hits.delete(k);
        });
      }
      return false;
    },
  };
}

/** The limit /api/assistant uses, and the agent's search tool shares:
 *  30 requests per 10 minutes per IP. */
export const ASSISTANT_WINDOW_MS = 10 * 60 * 1000;
export const ASSISTANT_MAX_REQUESTS = 30;

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
