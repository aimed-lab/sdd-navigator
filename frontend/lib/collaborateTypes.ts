// lib/collaborateTypes.ts — lab resource registry types + constants, shared by
// server and client.
//
// Same split as lib/collabTypes.ts / lib/server/collab.ts: a "use client"
// component (the resource form) needs the VALUE constants (RESOURCE_CATEGORIES,
// CATEGORY_LABELS, CATEGORY_FIELDS), and importing those from
// lib/server/collaborate.ts would drag its `next/headers`-dependent import
// chain into the client bundle. Rule: anything a client component imports as a
// value belongs HERE.

// The 8 spreadsheet categories the generic lab_resources table supports.
// Verbatim values from database/migrations/2026-07-21_lab_resources.sql.
export const RESOURCE_CATEGORIES = [
  "technique",
  "equipment",
  "vector",
  "animal_model",
  "cell_line",
  "protein_antibody",
  "software",
  "drug",
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

// Verbatim display labels, per spec: Technique | Equipment | Vector |
// Animal model | Cell line / xenograft / organoid | Antibody | Software | Drug.
export const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  technique: "Technique",
  equipment: "Equipment",
  vector: "Vector",
  animal_model: "Animal model",
  cell_line: "Cell line / xenograft / organoid",
  protein_antibody: "Antibody",
  software: "Software",
  drug: "Drug",
};

// One optional, category-specific field. `key` is where it lands inside the
// row's `fields` jsonb (alongside "name", which every category shares and is
// always required — handled separately from this table). Nothing here is
// required: per spec, the only required inputs anywhere on this form are
// name and category (type).
export type FieldSpec =
  | { key: string; label: string; kind: "text"; placeholder?: string }
  | { key: string; label: string; kind: "boolean" };

export const CATEGORY_FIELDS: Record<ResourceCategory, FieldSpec[]> = {
  technique: [{ key: "has_sop", label: "An SOP exists for this technique", kind: "boolean" }],
  equipment: [{ key: "location", label: "Location", kind: "text", placeholder: "e.g. Wallace Tumor Institute, Rm 410" }],
  vector: [
    { key: "backbone", label: "Backbone", kind: "text", placeholder: "e.g. pLVX-IRES-Puro" },
    { key: "vector_type", label: "Vector type", kind: "text", placeholder: "e.g. lentiviral" },
    { key: "insert", label: "Insert", kind: "text", placeholder: "e.g. PHGDH-GFP" },
  ],
  animal_model: [{ key: "genetic_alteration", label: "Genetic alteration", kind: "text", placeholder: "e.g. Nf1-/-;Trp53-/-" }],
  cell_line: [
    { key: "transduced", label: "Transduced", kind: "boolean" },
    { key: "transduced_with", label: "Transduced with", kind: "text", placeholder: "e.g. luciferase-GFP" },
  ],
  protein_antibody: [{ key: "protein_target", label: "Protein it targets", kind: "text", placeholder: "e.g. GFAP" }],
  software: [{ key: "utility", label: "What it's used for", kind: "text", placeholder: "e.g. batch-correct scRNA-seq" }],
  drug: [{ key: "target", label: "Target", kind: "text", placeholder: "e.g. PHGDH" }],
};

// One resource row for the browse grid. Kept here (not lib/server/collaborate.ts)
// so a client component can hold a list of these without a server-only import.
export type ResourceCard = {
  id: string;
  category: ResourceCategory | string;
  fields: Record<string, unknown>;
  created_at: string;
  owner_name: string | null;
  community_id: string | null;
};

export type CreateResourceInput = {
  category: ResourceCategory;
  fields: Record<string, unknown>;
  contact_info: string | null;
  community_id?: string | null;
};
