"use client";

import { useState } from "react";
import CreateCommunityForm from "./CreateCommunityForm";

/** Button-that-becomes-a-form, same idea as AgentSection's "Run agent"
 *  button collapsing into its own panel — the create form isn't worth a
 *  whole /communities/new route for two fields. */
export default function CreateCommunitySection() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
        New community
      </button>
    );
  }

  return <CreateCommunityForm onCancel={() => setOpen(false)} />;
}
