/**
 * scripts/backfill_description_capabilities.mjs — one-off classification
 * backfill for projects.description_capabilities.
 *
 * WHY THIS EXISTS. A project's description is classified ONCE, at
 * createProject() time (frontend/lib/server/projects.ts) — there is no
 * edit path for `description` anywhere in the frontend, so nothing else
 * ever re-triggers it. That means:
 *   - every project created BEFORE the description_capabilities column
 *     existed (2026-08-24_project_description_capabilities.sql) has it as
 *     NULL — never classified, not "confidently nothing";
 *   - every project classified before a later gate fix (see
 *     backend/explore-mcp/tools/find_provider.py's CLASSIFIER_GATE_VERSION
 *     and database/migrations/2026-08-24_description_capabilities_gate_version.sql)
 *     is STALE — a value on file, but computed under logic since changed.
 * app/api/find-providers-for-project/route.ts already treats both cases
 * the same as "never assessed" rather than trusting a possibly-wrong
 * answer. This script is how those rows actually get a current one.
 *
 * SAFE TO RE-RUN. Only touches rows where description_capabilities IS NULL
 * or description_capabilities_gate_version is behind CURRENT_GATE_VERSION
 * below (kept in sync by hand with find_provider.py's
 * CLASSIFIER_GATE_VERSION — there's no shared codegen across the
 * Python/TypeScript/this-script boundary, same duplication
 * checklistClassify.ts's CURRENT_CLASSIFIER_GATE_VERSION already accepts).
 * A project with no description at all is skipped (matches createProject()
 * — nothing to classify).
 *
 * Requires the SERVICE-ROLE key (bypasses RLS to read/write every
 * project's description_capabilities directly — this is a maintenance
 * operation, not something a project member's own session should need to
 * do). Reads it from backend/.env, same as scripts/seed_collab.mjs. Also
 * needs a reachable explore-mcp backend (EXPLORE_API_URL, default
 * http://localhost:8000) — this script does the SAME classification call
 * createProject() makes, just for existing rows instead of a new one.
 *
 * Usage:
 *   node scripts/backfill_description_capabilities.mjs           # apply
 *   node scripts/backfill_description_capabilities.mjs --dry-run # report only
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* file may not exist */
  }
  return out;
}

const env = loadEnv(join(ROOT, "backend", ".env"));
const URL_ = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_KEY; // service-role, same as seed_collab.mjs
const EXPLORE_API_URL = process.env.EXPLORE_API_URL || env.EXPLORE_API_URL || "http://localhost:8000";
const EXPLORE_API_TOKEN = process.env.EXPLORE_API_TOKEN || env.EXPLORE_API_TOKEN || "";

// MUST match find_provider.py's CLASSIFIER_GATE_VERSION — see that
// constant's own comment for the bump discipline. A row already at this
// version is left alone; anything behind it (or NULL) gets reclassified.
const CURRENT_GATE_VERSION = 1;

if (!URL_ || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_KEY in backend/.env");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

function sbHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function fetchProjectsNeedingBackfill() {
  const res = await fetch(
    `${URL_}/rest/v1/projects?select=id,name,description,description_capabilities,description_capabilities_gate_version&order=created_at`,
    { headers: sbHeaders() }
  );
  if (!res.ok) throw new Error(`projects fetch failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows.filter(
    (p) =>
      p.description &&
      p.description.trim() &&
      (p.description_capabilities === null ||
        p.description_capabilities_gate_version === null ||
        p.description_capabilities_gate_version < CURRENT_GATE_VERSION)
  );
}

async function classify(text) {
  const res = await fetch(`${EXPLORE_API_URL}/api/classify-checklist-item`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      ...(EXPLORE_API_TOKEN ? { Authorization: `Bearer ${EXPLORE_API_TOKEN}` } : {}),
    }),
    body: JSON.stringify({ item_text: text }),
  });
  if (!res.ok) throw new Error(`classify backend responded ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`classify backend reported: ${data.error}`);
  return {
    capabilities: Array.isArray(data.matched_capabilities) ? data.matched_capabilities : [],
    gateVersion: typeof data.gate_version === "number" ? data.gate_version : null,
  };
}

async function writeBack(id, capabilities, gateVersion) {
  const res = await fetch(`${URL_}/rest/v1/projects?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({
      description_capabilities: capabilities,
      description_capabilities_gate_version: gateVersion,
    }),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const targets = await fetchProjectsNeedingBackfill();
  console.log(`${targets.length} project(s) need (re)classification (current gate version = ${CURRENT_GATE_VERSION})`);

  for (const p of targets) {
    const wasStale =
      p.description_capabilities !== null && p.description_capabilities_gate_version !== CURRENT_GATE_VERSION;
    console.log(`\n${p.id}  ${p.name}`);
    console.log(`  reason: ${wasStale ? `stale (was gate v${p.description_capabilities_gate_version})` : "never classified"}`);

    if (DRY_RUN) continue;

    try {
      const { capabilities, gateVersion } = await classify(p.description);
      await writeBack(p.id, capabilities, gateVersion);
      console.log(`  -> capabilities=${JSON.stringify(capabilities)} gate_version=${gateVersion}`);
    } catch (e) {
      console.error(`  FAILED: ${e.message} — left as-is, safe to re-run this script later`);
    }
  }

  if (DRY_RUN) console.log("\n(dry run — nothing written)");
}

main();
