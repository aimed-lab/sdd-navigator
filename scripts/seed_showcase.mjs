/**
 * scripts/seed_showcase.mjs — DEMO SEEDS for the Promote showcase gallery.
 *
 *   ⚠️  THESE ARE DEMO ENTRIES, NOT REAL PUBLICATIONS OR CLAIMS.  ⚠️
 *
 * Illustrative content for the gallery UI. All owned by the SAME placeholder
 * account the Collaborate seeds use (SDD Demo Lab), and every description is
 * prefixed "[Demo]" so an entry can't be mistaken for a genuine submission.
 * No real DOIs are attached — `link` points at the platform, never at a real
 * paper we'd be misrepresenting.
 *
 * Delete with:  node scripts/seed_showcase.mjs --purge
 *
 * Requires the SERVICE-ROLE key (writes bypass RLS). Read from backend/.env.
 *
 * Usage:
 *   node scripts/seed_showcase.mjs           # insert the demo entries
 *   node scripts/seed_showcase.mjs --purge   # remove them
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
const KEY = env.SUPABASE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_KEY in backend/.env");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return body;
}

// Same placeholder owner as the Collaborate seeds.
const DEMO_EMAIL = "demo-collab@smartdrugdiscovery.invalid";
const DEMO_TAG = "[Demo] ";

// Images: only entries that should render the image card style get one. These
// are inline SVG data URIs generated below — no external hosts, nothing
// downloaded, and nothing that could be mistaken for a real figure.
function placeholderFigure(label, hex) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">` +
    `<rect width="800" height="450" fill="${hex}"/>` +
    `<text x="400" y="215" font-family="Inter,sans-serif" font-size="30" fill="#ffffff" ` +
    `text-anchor="middle">${label}</text>` +
    `<text x="400" y="255" font-family="Inter,sans-serif" font-size="18" fill="#ffffff" ` +
    `fill-opacity="0.75" text-anchor="middle">demo placeholder figure</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const ENTRIES = [
  {
    type: "case_study",
    title: "Cutting hit-to-lead time by pairing virtual screening with a shared assay core",
    description:
      "How a two-lab partnership moved from 1.2M compounds to a validated chemical series in eleven weeks, and what the handoff between computational triage and wet-lab confirmation actually looked like week by week.",
    authors: "SDD Demo Lab",
    tags: ["virtual screening", "hit-to-lead", "collaboration"],
    image: placeholderFigure("Hit-to-lead workflow", "#00523c"),
  },
  {
    type: "paper",
    title: "Serine-pathway dependency as a selective vulnerability in treatment-resistant tumours",
    description:
      "A demonstration entry showing how a published paper appears in the showcase, with its author line, abstract summary and an outbound link to the source of record.",
    authors: "SDD Demo Lab, Collaborating Authors",
    tags: ["cancer metabolism", "PHGDH", "resistance"],
    image: null, // text-only card
  },
  {
    type: "white_paper",
    title: "A practical framework for evaluating AI-generated hypotheses before wet-lab commitment",
    description:
      "Five checks a lab can apply to a model-proposed target before spending bench time on it — provenance, plausibility, prior art, assay tractability, and the cost of being wrong.",
    authors: "SDD Demo Lab",
    tags: ["AI in drug discovery", "methodology", "evaluation"],
    image: placeholderFigure("Evaluation framework", "#1e6b52"),
  },
  {
    type: "achievement",
    title: "Shared instrumentation core reaches 100 external projects supported",
    description:
      "A milestone entry: the imaging and structural core passed one hundred externally-led projects, roughly two thirds of them from labs without their own instrument access.",
    authors: "SDD Demo Lab",
    tags: ["core facility", "milestone", "shared instrumentation"],
    image: null, // text-only card
  },
  {
    type: "achievement",
    title: "Open dataset release: 12,000 annotated zebrafish toxicity readouts",
    description:
      "A demonstration entry for a data release — what was published, how it is licensed, and how another lab would reuse it.",
    authors: "SDD Demo Lab",
    tags: ["open data", "toxicology", "zebrafish"],
    image: placeholderFigure("Open dataset release", "#0d9488"),
  },
];

async function ownerId() {
  const list = await rest(`/auth/v1/admin/users?per_page=200`);
  const users = Array.isArray(list) ? list : list?.users || [];
  const u = users.find((x) => (x.email || "").toLowerCase() === DEMO_EMAIL.toLowerCase());
  if (!u) {
    throw new Error(
      "Demo owner not found. Run `node scripts/seed_collab.mjs` first — it creates the shared placeholder account."
    );
  }
  return u.id;
}

async function purge() {
  const id = await ownerId();
  await rest(`/rest/v1/promote_showcase?owner_id=eq.${id}`, { method: "DELETE" });
  console.log("  deleted demo showcase entries");
}

async function seed() {
  const id = await ownerId();
  console.log(`  owner: ${id} (SDD Demo Lab)`);

  await rest(`/rest/v1/promote_showcase?owner_id=eq.${id}`, { method: "DELETE" });

  const rows = ENTRIES.map((e) => ({
    owner_id: id,
    type: e.type,
    title: e.title,
    description: DEMO_TAG + e.description,
    authors: e.authors,
    link: "https://www.smartdrugdiscovery.org/",
    image_url: e.image,
    tags: e.tags,
  }));

  const inserted = await rest(`/rest/v1/promote_showcase`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });

  console.log(`  inserted ${inserted.length} demo entries`);
  for (const r of inserted) {
    console.log(`    [${r.type.padEnd(11)}] ${r.image_url ? "image" : "text "}  ${r.title.slice(0, 56)}`);
  }
}

const purgeMode = process.argv.includes("--purge");
console.log(purgeMode ? "Purging showcase demo seeds…" : "Seeding showcase demo entries…");
try {
  await (purgeMode ? purge() : seed());
  console.log("Done.");
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
}
