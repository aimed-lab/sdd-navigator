"use client";

// "Add what your lab can share" — one short form, no wizard. Only `name` and
// `category` (the type picker) are required; every other field is optional
// and conditional on the chosen category, shown/collapsed inline as soon as a
// category is picked — never a separate page or step per category.
//
// Only rendered for a signed-in user — the page shows a sign-in gate
// instead when signed out. createResourceAction re-checks server-side
// regardless (requireCurrentUser), and RLS (can_post_to_community, when a
// community is set) is the real gate on whether the write is allowed.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createResourceAction } from "@/app/collaborate/actions";
import {
  CATEGORY_FIELDS,
  CATEGORY_LABELS,
  RESOURCE_CATEGORIES,
  type ResourceCategory,
} from "@/lib/collaborateTypes";

export default function AddResourceForm({
  communityId,
  communityName,
  returnTo = "/collaborate",
}: {
  /** Resolved server-side from the ?community= slug — passed straight
   *  through to createResourceAction; RLS is what actually decides whether
   *  this caller may post into it. */
  communityId?: string | null;
  communityName?: string | null;
  returnTo?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ResourceCategory | "">("");
  const [lab, setLab] = useState("");
  const [contact, setContact] = useState("");
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const specs = category ? CATEGORY_FIELDS[category] : [];

  const setField = (key: string, value: string | boolean) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim() || !category) {
      setError("A name and a category are required.");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await createResourceAction({
      category,
      fields: { name, pi_lab: lab, ...fields },
      contact_info: contact,
      community_id: communityId ?? null,
    });

    if (res.ok) {
      router.push(returnTo);
      router.refresh();
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {communityName && (
        <p className="font-label-md text-label-md text-primary">
          Sharing into <span className="font-semibold">{communityName}</span>
        </p>
      )}

      <section className="glass-panel rounded-2xl p-6 space-y-5">
        <h2 className="font-headline-md text-lg text-on-background">The basics</h2>

        <div>
          <label htmlFor="name" className="block font-label-md text-label-md text-on-background mb-2">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Orthotopic PDX implantation protocol"
            className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div>
          <label htmlFor="category" className="block font-label-md text-label-md text-on-background mb-2">
            Type
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as ResourceCategory);
              setFields({}); // switching category drops the previous category's fields
            }}
            required
            className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="" disabled>
              Choose a category…
            </option>
            {RESOURCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="lab" className="block font-label-md text-label-md text-on-background mb-2">
            Lab <span className="text-secondary font-body-sm">(optional)</span>
          </label>
          <input
            id="lab"
            type="text"
            value={lab}
            onChange={(e) => setLab(e.target.value)}
            placeholder="e.g. Nabors Lab"
            className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </section>

      {/* Category-specific fields — shown inline, collapsed to nothing until
          a category is chosen. Every one of these is optional. */}
      {category && specs.length > 0 && (
        <section className="glass-panel rounded-2xl p-6 space-y-5">
          <h2 className="font-headline-md text-lg text-on-background">
            {CATEGORY_LABELS[category]} details{" "}
            <span className="text-secondary font-body-sm">(optional)</span>
          </h2>

          {specs.map((spec) =>
            spec.kind === "boolean" ? (
              <label key={spec.key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(fields[spec.key])}
                  onChange={(e) => setField(spec.key, e.target.checked)}
                  className="h-4 w-4 rounded border-outline-variant/60"
                />
                <span className="font-body-md text-body-md text-on-background">{spec.label}</span>
              </label>
            ) : (
              <div key={spec.key}>
                <label
                  htmlFor={spec.key}
                  className="block font-label-md text-label-md text-on-background mb-2"
                >
                  {spec.label}
                </label>
                <input
                  id={spec.key}
                  type="text"
                  value={(fields[spec.key] as string) ?? ""}
                  onChange={(e) => setField(spec.key, e.target.value)}
                  placeholder={spec.placeholder}
                  className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )
          )}
        </section>
      )}

      <section className="glass-panel rounded-2xl p-6">
        <label htmlFor="contact" className="block font-label-md text-label-md text-on-background mb-2">
          How should people reach you?{" "}
          <span className="text-secondary font-body-sm">(optional)</span>
        </label>
        <input
          id="contact"
          type="text"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="An email, a handle, or leave blank"
          className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </section>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link href={returnTo} className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {saving ? "Sharing…" : "Share it"}
        </button>
      </div>
    </form>
  );
}
