// lib/server/exploreBackend.ts — the one place every Next.js route that
// proxies to the Python explore-mcp backend reads EXPLORE_API_URL and builds
// its request headers. Four call sites (app/api/explore, app/api/papers,
// app/api/project-agent/start, app/api/project-agent/status) used to each
// hardcode `process.env.EXPLORE_API_URL ?? "http://localhost:8000"`
// separately — pulled out here so EXPLORE_API_TOKEN gets added in exactly
// one place instead of copy-pasted into four.
//
// EXPLORE_API_TOKEN IS SERVER-ONLY. No NEXT_PUBLIC_ prefix — that prefix is
// what makes a Next.js env var ship into the browser bundle; this file is
// only ever imported from route handlers and other lib/server/* modules
// (never a "use client" component), so the token never crosses into
// anything the browser can read. Grep the codebase for NEXT_PUBLIC before
// ever touching this file — the token must never gain that prefix.
//
// OPTIONAL BY DESIGN, matching the backend's own EXPLORE_API_TOKEN stance
// (see backend/explore-mcp/server.py's BearerAuthMiddleware): unset here
// means no Authorization header is sent, which works fine against a backend
// that also has no token configured. Setting it on both sides is what turns
// auth on. No build-time failure either way — this is read at request time,
// not import time, so a missing token never breaks `next build`.

export const EXPLORE_API_URL = process.env.EXPLORE_API_URL ?? "http://localhost:8000";

const EXPLORE_API_TOKEN = process.env.EXPLORE_API_TOKEN || "";

/** Headers for a fetch() to the explore-mcp backend: Authorization only when
 *  a token is actually configured, so an unset token produces plain headers
 *  (or none) rather than `Authorization: Bearer undefined`. Merge in
 *  call-site-specific headers (e.g. Content-Type) via `extra`. */
export function exploreBackendHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    ...(EXPLORE_API_TOKEN ? { Authorization: `Bearer ${EXPLORE_API_TOKEN}` } : {}),
  };
}
