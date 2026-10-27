"use client";

// One entry point for sharing from a team page: a photo, team news (leads
// only) or Promote's public flow. Each choice is the existing panel, as it was.

import { useState } from "react";
import NewsPanel from "./NewsPanel";
import SharePhotoPanel from "./SharePhotoPanel";

type Choice = "photo" | "news" | "promote";

export default function SharePromotePanel({
  teamId,
  slug,
  name,
  description,
  isLead,
  onClose,
}: {
  teamId: string;
  slug: string;
  name: string;
  description: string | null;
  isLead: boolean;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice>("photo");
  const choices: { key: Choice; label: string; icon: string }[] = [
    { key: "photo", label: "Share a photo", icon: "add_photo_alternate" },
    ...(isLead ? [{ key: "news" as const, label: "Post team news", icon: "campaign" }] : []),
    { key: "promote", label: "Promote publicly", icon: "share" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="What to share" className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={choice === c.key}
            onClick={() => setChoice(c.key)}
            className={`px-4 py-2 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5 border transition-colors ${
              choice === c.key
                ? "bg-[#e9f5ec] border-[#0f6b33] text-[#0f6b33]"
                : "bg-white border-[#e8e4da] text-secondary hover:text-on-background"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>

      {choice === "photo" && <SharePhotoPanel teamId={teamId} slug={slug} name={name} description={description} />}
      {choice === "news" && isLead && <NewsPanel teamId={teamId} slug={slug} isLead={isLead} onClose={onClose} section="news" />}
      {choice === "promote" && <NewsPanel teamId={teamId} slug={slug} isLead={isLead} onClose={onClose} section="promote" />}
    </div>
  );
}
