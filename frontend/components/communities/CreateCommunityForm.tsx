"use client";

// Create-community form — /communities. Deliberately small next to
// CreateProjectForm (name + purpose, nothing else): every community made
// through this is private by construction (no is_open toggle — see
// create_community_with_admin's own comment), and the creator becomes
// admin without asking, so there's nothing else to choose here.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCommunityAction } from "@/app/communities/actions";

export default function CreateCommunityForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!name.trim()) {
      setError("A community name is required.");
      return;
    }
    if (!purpose.trim()) {
      setError("Say what this community is for.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await createCommunityAction({ name, purpose });
    if (res.ok) {
      router.push(`/communities/${res.slug}`);
    } else {
      setError(res.error);
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-surface-container-low border border-surface-dim rounded-lg px-4 py-3 font-body-md text-body-md text-on-background focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none";

  return (
    <form onSubmit={submit} className="glass-card rounded-xl p-6 md:p-8 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="community-name" className="font-label-md text-label-md text-on-surface-variant">
          Community name
        </label>
        <input
          id="community-name"
          type="text"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Neuro-Oncology Working Group"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="community-purpose" className="font-label-md text-label-md text-on-surface-variant">
          What is it for?
        </label>
        <textarea
          id="community-purpose"
          required
          rows={2}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="One line a stranger could read and know whether to request to join."
          className={`${inputClass} resize-none`}
        />
      </div>

      <p className="font-body-sm text-body-sm text-secondary">
        Private — people request to join, and you approve them. You become admin.
      </p>

      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create community"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="font-label-md text-label-md text-secondary hover:text-on-background transition-colors px-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
