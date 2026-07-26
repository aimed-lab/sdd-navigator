"use client";

// One board post. Layout follows
// design/stitch/smartdrugdiscovery_premium_collaborate_board, restyled in the
// shared design system.
//
// Haves and needs are visually DISTINCT but both QUIET: two labelled groups,
// primary-tinted for offers and secondary-tinted for asks, at body-sm weight.
// The single loud element on the card is Connect — the one action.
//
// Client-side only because of the modal; the data all arrives as props from the
// server-rendered board.

import { useState } from "react";
import Link from "next/link";
import ConnectModal from "./ConnectModal";
import type { CollabPost, Stage } from "@/lib/collabTypes";

const STAGE_LABEL: Record<Stage, string> = {
  concept: "Concept",
  early_data: "Early data",
  validation: "In validation",
  preclinical: "Pre-clinical",
  seeking_team: "Seeking team",
};

function PillGroup({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "offer" | "need";
}) {
  if (items.length === 0) return null;
  const pill =
    tone === "offer"
      ? "bg-primary/5 text-on-surface-variant"
      : "bg-secondary-container/40 text-on-surface-variant";
  return (
    <div>
      <span className="block font-label-sm text-label-sm text-secondary/70 uppercase mb-2">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {items.map((t) => (
          <span key={t} className={`px-3 py-1 rounded-full font-body-sm text-body-sm ${pill}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PostCard({
  post,
  signedIn,
}: {
  post: CollabPost;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const owner = post.owner;
  const ownerLine = [owner?.name, owner?.institution ?? owner?.affiliation]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <article className="glass-panel rounded-2xl p-7 flex flex-col h-full">
        {/* areas + stage */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {post.research_areas.slice(0, 3).map((a) => (
            <span
              key={a}
              className="px-3 py-1 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm"
            >
              {a}
            </span>
          ))}
          <span className="ml-auto px-3 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm">
            {STAGE_LABEL[post.stage]}
          </span>
        </div>

        <h3 className="font-headline-md text-lg leading-tight text-on-background mb-3">
          {post.title}
        </h3>
        {post.description && (
          <p className="font-body-md text-body-md text-secondary mb-5 line-clamp-3">
            {post.description}
          </p>
        )}

        <div className="space-y-4">
          <PillGroup label="Offering" items={post.haves} tone="offer" />
          <PillGroup label="Seeking" items={post.needs} tone="need" />
        </div>

        {/* owner + single action */}
        <div className="mt-auto pt-6">
          <div className="pt-5 border-t border-outline-variant/30">
            <p className="font-label-md text-label-md text-on-background truncate">
              {ownerLine || "Community member"}
            </p>
            <div className="flex items-center gap-3 mt-1">
              {owner?.profile_slug ? (
                <Link
                  href={`/researchers/${owner.profile_slug}`}
                  className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4"
                >
                  View profile
                </Link>
              ) : (
                <span className="font-label-sm text-label-sm text-secondary/60">
                  No public profile
                </span>
              )}
              <span className="text-secondary/40">•</span>
              <span className="font-body-sm text-body-sm text-secondary/70">
                {post.interested} interested
              </span>
            </div>

            <button
              onClick={() => setOpen(true)}
              className="btn-primary w-full mt-5 px-6 py-3 rounded-xl font-label-md text-label-md"
            >
              Connect
            </button>
          </div>
        </div>
      </article>

      {open && (
        <ConnectModal
          postId={post.id}
          postTitle={post.title}
          signedIn={signedIn}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
