"use client";

// Admin control over which sections show on the community's own page, and
// in what order — inside the "Manage community" card, per spec. Local
// state is the full ordered array (initialized from the resolved sections
// the page already computed — see resolveSections in lib/communityTypes.ts
// — so this always starts from what's ACTUALLY showing, never a bare
// default even when the community has never customized anything yet).
// Save writes the whole array; nothing is persisted until then, so
// checkbox/reorder clicks are free to try and Cancel is just "don't call
// Save".

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCommunitySectionsAction } from "@/app/communities/actions";
import { SECTION_LABEL, type SectionConfig } from "@/lib/communityTypes";

export default function SectionsEditor({
  communityId,
  slug,
  sections,
}: {
  communityId: string;
  slug: string;
  sections: SectionConfig[];
}) {
  const router = useRouter();
  const [local, setLocal] = useState<SectionConfig[]>(sections);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggle = (key: SectionConfig["key"]) => {
    setSaved(false);
    setLocal((prev) => prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= local.length) return;
    setSaved(false);
    setLocal((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await updateCommunitySectionsAction(communityId, local, slug);
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-label-lg text-label-lg text-on-background">Sections</h3>
      <p className="font-body-sm text-body-sm text-secondary">
        Choose what shows on this community&apos;s page, and in what order.
      </p>

      <ul className="rounded-lg border border-outline-variant/30 divide-y divide-outline-variant/20">
        {local.map((section, i) => (
          <li key={section.key} className="flex items-center gap-3 px-4 py-2.5">
            <label className="flex items-center gap-2.5 flex-1 cursor-pointer">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={() => toggle(section.key)}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span className="font-body-sm text-body-sm text-on-background">
                {SECTION_LABEL[section.key]}
              </span>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${SECTION_LABEL[section.key]} up`}
                className="w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-background disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === local.length - 1}
                aria-label={`Move ${SECTION_LABEL[section.key]} down`}
                className="w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-background disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-outline px-5 py-2 rounded-lg font-label-sm text-label-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !error && (
          <span className="font-body-sm text-body-sm text-primary">Saved.</span>
        )}
        {error && (
          <span className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
