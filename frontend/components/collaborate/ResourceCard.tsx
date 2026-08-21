// One lab resource tile on /collaborate. Plain server-rendered display — no
// interactivity needed here (contact reveal isn't part of this pass; see
// lib/server/collaborate.ts's getResourceContact for the auth-gated read a
// future "Contact" action would call).

import { CATEGORY_LABELS, type ResourceCategory } from "@/lib/collaborateTypes";
import type { ResourceCard as ResourceCardData } from "@/lib/collaborateTypes";

// Fields worth surfacing on the card, per category — mirrors CATEGORY_FIELDS
// in lib/collaborateTypes.ts but with the display label already resolved
// there, so this is just "which keys, in what order".
const DISPLAY_FIELDS: Record<ResourceCategory, { key: string; label: string }[]> = {
  technique: [{ key: "has_sop", label: "SOP" }],
  equipment: [{ key: "location", label: "Location" }],
  vector: [
    { key: "backbone", label: "Backbone" },
    { key: "vector_type", label: "Type" },
    { key: "insert", label: "Insert" },
  ],
  animal_model: [{ key: "genetic_alteration", label: "Genetic alteration" }],
  cell_line: [
    { key: "transduced", label: "Transduced" },
    { key: "transduced_with", label: "Transduced with" },
  ],
  protein_antibody: [{ key: "protein_target", label: "Targets" }],
  software: [{ key: "utility", label: "Used for" }],
  drug: [{ key: "target", label: "Target" }],
};

function fieldValue(v: unknown): string | null {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export default function ResourceCard({
  resource,
}: {
  resource: ResourceCardData;
  signedIn: boolean;
}) {
  const category = resource.category as ResourceCategory;
  const label = CATEGORY_LABELS[category] ?? resource.category;
  const name = typeof resource.fields.name === "string" ? resource.fields.name : "Untitled resource";
  const lab = typeof resource.fields.pi_lab === "string" ? resource.fields.pi_lab : null;
  const rows = (DISPLAY_FIELDS[category] ?? [])
    .map((f) => ({ label: f.label, value: fieldValue(resource.fields[f.key]) }))
    .filter((r) => r.value !== null);

  return (
    <article className="glass-panel rounded-2xl p-7 flex flex-col h-full">
      <span className="self-start px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm mb-4">
        {label}
      </span>

      <h3 className="font-headline-md text-lg leading-tight text-on-background mb-1">{name}</h3>
      {lab && <p className="font-body-sm text-body-sm text-secondary mb-4">{lab}</p>}

      {rows.length > 0 && (
        <dl className="space-y-1.5 mt-1">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-2 font-body-sm text-body-sm">
              <dt className="text-secondary/70 shrink-0">{r.label}:</dt>
              <dd className="text-on-background truncate">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto pt-6 border-t border-outline-variant/30">
        <p className="font-label-md text-label-md text-on-background truncate">
          {resource.owner_name || "Community member"}
        </p>
      </div>
    </article>
  );
}
