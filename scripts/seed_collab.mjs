/**
 * scripts/seed_collab.mjs — DEMO SEEDS for the Collaborate board.
 *
 *   ⚠️  THESE ARE DEMO POSTS, NOT REAL COLLABORATION OFFERS.  ⚠️
 *
 * Every row written here is illustrative content for the board UI. They are all
 * owned by ONE placeholder account (see DEMO_OWNER) and every title is tagged in
 * the description so a reader can never mistake a seed for a genuine listing.
 * Delete them with:  node scripts/seed_collab.mjs --purge
 *
 * Requires the SERVICE-ROLE key (writes bypass RLS, and creating the placeholder
 * owner needs the Auth Admin API). Reads it from backend/.env — never hardcoded.
 *
 * Usage:
 *   node scripts/seed_collab.mjs           # create owner + 6 posts (idempotent)
 *   node scripts/seed_collab.mjs --purge   # remove the demo posts and owner
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
const KEY = env.SUPABASE_KEY; // service-role
if (!URL_ || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_KEY in backend/.env");
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

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

// The placeholder account every demo post belongs to. Clearly labelled so it is
// obvious in the UI that these are not a real person's listings.
const DEMO_OWNER = {
  email: "demo-collab@smartdrugdiscovery.invalid", // .invalid TLD — never routable
  name: "SDD Demo Lab",
  affiliation: "Demo Content",
  institution: "SmartDrugDiscovery (sample data)",
  profile_slug: "sdd-demo-lab",
};

const DEMO_TAG = "[Demo post] ";

/** 6 posts: 2 pure offers, 2 pure asks, 2 both. */
const POSTS = [
  {
    title: "PHGDH inhibitor series — seeking in vivo validation partner",
    description:
      "We have a validated series of small-molecule PHGDH inhibitors with sub-micromolar potency in serine-dependent breast cancer lines, plus full SAR and selectivity data. We are looking for a group with orthotopic xenograft capability to take the lead compounds into an in vivo efficacy study.",
    research_areas: ["Cancer Metabolism", "Medicinal Chemistry", "Oncology"],
    haves: ["Validated inhibitor series", "SAR dataset", "Selectivity panel", "Compound supply"],
    needs: ["In vivo xenograft models", "PK/PD expertise", "Co-investigator for R01"],
    stage: "validation",
  },
  {
    title: "Two-photon intravital imaging — open to collaborations",
    description:
      "Our core runs a two-photon microscope with a cranial-window setup for live imaging of neurovascular and immune dynamics in mouse models. We have open capacity and experienced staff, and are happy to support external projects as a collaborating partner.",
    research_areas: ["Neuroscience", "Imaging", "Immunology"],
    haves: [
      "Two-photon intravital microscope",
      "Cranial window surgery",
      "Longitudinal imaging protocols",
      "Image analysis pipeline",
    ],
    needs: [],
    stage: "concept",
  },
  {
    title: "CryoEM structure determination capacity available",
    description:
      "Krios-access facility with an experienced structural biology team. We can take a purified, behaving sample through grid preparation, screening, collection and reconstruction. Best fit for membrane proteins and mid-size complexes.",
    research_areas: ["Structural Biology", "Biophysics"],
    haves: [
      "Titan Krios access",
      "Grid optimisation",
      "Single-particle reconstruction",
      "Model building & refinement",
    ],
    needs: [],
    stage: "concept",
  },
  {
    title: "Building a team: AI-guided antibiotic discovery for Gram-negatives",
    description:
      "Assembling a multi-disciplinary team around a generative-model approach to novel scaffolds against carbapenem-resistant Enterobacterales. We have the computational pipeline and preliminary hit predictions; we are missing the wet-lab half entirely.",
    research_areas: ["Antimicrobial Resistance", "Machine Learning", "Microbiology"],
    // Deliberately a PURE NEED (no haves) so the board has a needs-only card and
    // the "Seeking Resources" filter has a real example that isn't also an offer.
    haves: [],
    needs: [
      "Microbiology co-lead",
      "MIC assay capability",
      "Medicinal chemist",
      "Grant co-applicants",
      "Wet-lab validation partner",
    ],
    stage: "seeking_team",
  },
  {
    title: "Patient-derived GBM organoids — need scRNA-seq partner",
    description:
      "We maintain a living biobank of patient-derived glioblastoma organoids with matched clinical annotation and drug-response data. We are looking for a group with single-cell sequencing capacity to profile treatment-resistant populations with us.",
    research_areas: ["Oncology", "Genomics", "Neuro-oncology"],
    haves: ["PDO biobank", "Matched clinical annotation", "Drug-response profiles"],
    needs: ["Single-cell RNA-seq", "Bioinformatics support", "Spatial transcriptomics"],
    stage: "early_data",
  },
  {
    title: "Zebrafish toxicology screening — seeking compound sets",
    description:
      "Our facility runs high-throughput developmental toxicity and cardiotoxicity screens in zebrafish embryos, with automated imaging and scoring. We have throughput to spare and would like to partner with groups holding compound libraries that need early safety triage.",
    research_areas: ["Toxicology", "Preclinical Safety", "Model Organisms"],
    haves: [
      "Zebrafish screening facility",
      "Automated imaging & scoring",
      "Developmental tox assays",
      "Cardiotox readouts",
    ],
    needs: ["Compound libraries", "Medicinal chemistry input"],
    stage: "preclinical",
  },
];

// ── owner ────────────────────────────────────────────────────────────────────

async function findAuthUser(email) {
  const list = await rest(`/auth/v1/admin/users?per_page=200`);
  const users = Array.isArray(list) ? list : list?.users || [];
  return users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function ensureOwner() {
  let authUser = await findAuthUser(DEMO_OWNER.email);
  if (!authUser) {
    authUser = await rest(`/auth/v1/admin/users`, {
      method: "POST",
      body: JSON.stringify({
        email: DEMO_OWNER.email,
        email_confirm: true,
        user_metadata: { name: DEMO_OWNER.name, demo_seed: true },
      }),
    });
    console.log(`  created placeholder auth user ${authUser.id}`);
  } else {
    console.log(`  placeholder auth user already exists ${authUser.id}`);
  }

  // public.users may be auto-created by the handle_new_user trigger; upsert the
  // display fields either way so posts render with a name.
  await rest(`/rest/v1/users?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      {
        id: authUser.id,
        email: DEMO_OWNER.email,
        name: DEMO_OWNER.name,
        affiliation: DEMO_OWNER.affiliation,
        institution: DEMO_OWNER.institution,
        profile_slug: DEMO_OWNER.profile_slug,
        // Deliberately PRIVATE. The board no longer needs this to be true: it
        // reads owner identity via collab_post_owners(), which surfaces a
        // poster's name regardless of profile visibility. Keeping it false means
        // the demo account does NOT show up in /researchers discovery — and it
        // doubles as the live check that the non-public-owner path works.
        is_public: false,
      },
    ]),
  });
  return authUser.id;
}

// ── seed / purge ─────────────────────────────────────────────────────────────

async function purge() {
  const authUser = await findAuthUser(DEMO_OWNER.email);
  if (!authUser) {
    console.log("  no demo owner found — nothing to purge");
    return;
  }
  await rest(`/rest/v1/collab_posts?owner_id=eq.${authUser.id}`, { method: "DELETE" });
  console.log("  deleted demo posts");
  await rest(`/auth/v1/admin/users/${authUser.id}`, { method: "DELETE" });
  console.log("  deleted demo owner");
}

async function seed() {
  const ownerId = await ensureOwner();

  // Idempotent: clear this owner's existing demo posts, then insert the set.
  await rest(`/rest/v1/collab_posts?owner_id=eq.${ownerId}`, { method: "DELETE" });

  const rows = POSTS.map((p) => ({
    owner_id: ownerId,
    title: p.title,
    description: DEMO_TAG + p.description,
    research_areas: p.research_areas,
    haves: p.haves,
    needs: p.needs,
    stage: p.stage,
  }));

  const inserted = await rest(`/rest/v1/collab_posts`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });

  console.log(`  inserted ${inserted.length} demo posts`);
  for (const r of inserted) {
    const kind =
      r.haves.length && r.needs.length ? "both " : r.haves.length ? "offer" : "ask  ";
    console.log(`    [${kind}] ${r.stage.padEnd(12)} ${r.title.slice(0, 58)}`);
  }
}

const purgeMode = process.argv.includes("--purge");
console.log(purgeMode ? "Purging Collaborate demo seeds…" : "Seeding Collaborate demo posts…");
try {
  await (purgeMode ? purge() : seed());
  console.log("Done.");
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
}
