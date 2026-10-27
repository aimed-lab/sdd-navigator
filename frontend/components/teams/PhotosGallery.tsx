"use client";

// Photos: a three-column square grid, newest first. The first cell is a dashed "+"
// that adds a photo. Tapping a photo opens a full-screen lightbox with the caption,
// who shared it and when, previous / next (buttons, arrow keys or a swipe), the
// share buttons (LinkedIn, X, Facebook) and, for the people who may remove it
// (leads and whoever added it), a Remove button. The pictures are shared items whose
// file is an image; they are not listed under Slides & files.

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { deleteCommunityResourceAction } from "@/app/communities/actions";
import { Portal, useModal } from "@/components/ui/Sheet";
import { downloadHref, shortDate } from "@/lib/server/communityHome/communityHome";
import { FACEBOOK_URL, linkedInUrl, xUrl } from "@/lib/server/teams/photoShare";
import { byLine, swipeStep, wrapIndex } from "@/lib/server/teams/teamUi";
import type { CommunityResource } from "@/lib/server/communities";
import { Err, useDo } from "./TeamShelves";
import { useTeamPanel } from "./TeamPanelContext";

function srcOf(r: CommunityResource): string {
  return r.files[0]?.url ?? r.url ?? "";
}

export default function PhotosGallery({
  teamId,
  slug,
  photos,
  viewerId,
  isLead,
  names,
}: {
  teamId: string;
  slug: string;
  /** Newest first. */
  photos: CommunityResource[];
  viewerId: string;
  isLead: boolean;
  names: Record<string, string>;
}) {
  const { busy, error, run } = useDo();
  const panel = useTeamPanel();
  const [openAt, setOpenAt] = useState<number | null>(null);

  const remove = async (r: CommunityResource) => {
    if (!window.confirm(`Remove "${r.title}" from the team?`)) return;
    setOpenAt(null);
    await run(r.id, () => deleteCommunityResourceAction(teamId, r.id, slug));
  };

  return (
    <>
      <ul className="grid grid-cols-3 gap-1.5">
        <li>
          <button
            type="button"
            onClick={() => panel.open("photo")}
            aria-label="Add a photo"
            className="w-full aspect-square rounded-[10px] border-[1.5px] border-dashed border-[#cfc8b8] bg-white grid place-items-center text-[#0f6b33] hover:border-[#0f6b33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33]"
          >
            <Plus size={22} strokeWidth={1.75} aria-hidden />
          </button>
        </li>
        {photos.map((r, i) => (
          <li key={r.id} data-item-id={r.id} className={`min-w-0 ${busy === r.id ? "opacity-50" : ""}`}>
            <button
              type="button"
              onClick={() => setOpenAt(i)}
              aria-label={`Open photo: ${r.title}`}
              className="block w-full aspect-square rounded-[10px] overflow-hidden bg-[#e7e2d6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcOf(r)} alt={r.title} loading="lazy" className="w-full h-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {photos.length === 0 && <p className="mt-3 text-[13px] leading-5 text-[#6b6a64]">No photos yet. Tap the + to share the first one.</p>}
      <Err text={error} />
      {openAt !== null && (
        <Portal>
          <LightboxBody
            photos={photos}
            start={Math.min(openAt, photos.length - 1)}
            names={names}
            canRemove={(r) => isLead || r.added_by === viewerId}
            onRemove={remove}
            onClose={() => setOpenAt(null)}
          />
        </Portal>
      )}
    </>
  );
}

const SHARE_BTN =
  "inline-flex items-center rounded-lg border border-white/50 px-3.5 py-2 text-[14px] font-semibold leading-5 text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";

function LightboxBody({
  photos,
  start,
  names,
  canRemove,
  onRemove,
  onClose,
}: {
  photos: CommunityResource[];
  start: number;
  names: Record<string, string>;
  canRemove: (r: CommunityResource) => boolean;
  onRemove: (r: CommunityResource) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  const touchX = useRef<number | null>(null);
  useModal(ref, onClose);

  const go = (step: number) => setI((cur) => wrapIndex(cur + step, photos.length));
  const r = photos[Math.min(i, photos.length - 1)];
  const first = r.files[0];
  const caption = r.title;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      tabIndex={-1}
      className="fixed inset-0 z-[85] bg-black/95 text-white flex flex-col outline-none"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const x0 = touchX.current;
        touchX.current = null;
        if (x0 === null) return;
        const step = swipeStep((e.changedTouches[0]?.clientX ?? x0) - x0);
        if (step) go(step);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[14px] text-white/80">
          {i + 1} of {photos.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <X size={24} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2">
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 z-10 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <ChevronLeft size={24} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={srcOf(r)} alt={r.title} className="max-w-full max-h-full object-contain select-none" draggable={false} />
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 z-10 w-11 h-11 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <ChevronRight size={24} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col gap-3 max-h-[40dvh] overflow-y-auto">
        <div>
          <p className="text-[16px] leading-6 font-semibold break-words">{caption}</p>
          <p className="text-[13px] leading-5 text-white/70">{byLine(names[r.added_by], shortDate(r.created_at))}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={linkedInUrl(caption)} target="_blank" rel="noopener noreferrer" className={SHARE_BTN}>
            LinkedIn
          </a>
          <a href={xUrl(caption)} target="_blank" rel="noopener noreferrer" className={SHARE_BTN}>
            X
          </a>
          <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className={SHARE_BTN}>
            Facebook
          </a>
          {first && (
            <a href={downloadHref(first.url, first.filename)} className={SHARE_BTN}>
              Download
            </a>
          )}
          {canRemove(r) && (
            <button type="button" onClick={() => onRemove(r)} className={SHARE_BTN}>
              Remove
            </button>
          )}
        </div>
        <p className="text-[12.5px] leading-5 text-white/60">Download the photo, then attach it to your post.</p>
      </div>
    </div>
  );
}
