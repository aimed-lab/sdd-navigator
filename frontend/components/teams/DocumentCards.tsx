"use client";

// Slides & files: cards, one column on a phone and two on a desktop. A cover with
// a SLIDES (green), PDF (black) or LINK badge top left, the file type and size top
// right, and the title in serif on it; under it who added it, the date, a green
// "View" button (opens in a new tab) and the ⋯ menu. Download, Pin (leads) and
// Remove (leads and the person who added it) live in the ⋯ menu, as before.
// Photos are not here: they are under Photos.

import { ExternalLink, Pin, Plus } from "lucide-react";
import { deleteCommunityResourceAction, pinCommunityResourceAction } from "@/app/communities/actions";
import MoreMenu, { type MoreMenuItem } from "@/components/MoreMenu";
import { downloadHref, shortDate } from "@/lib/server/communityHome/communityHome";
import { fileKind, typeLine } from "@/lib/server/teams/teamUi";
import type { CommunityResource } from "@/lib/server/communities";
import { Empty, Err, useDo } from "./TeamShelves";
import { useTeamPanel } from "./TeamPanelContext";

const BADGE: Record<string, { text: string; bg: string }> = {
  slides: { text: "SLIDES", bg: "#0f6b33" },
  pdf: { text: "PDF", bg: "#1d1d1b" },
  link: { text: "LINK", bg: "#4b4f48" },
};

export default function DocumentCards({
  teamId,
  slug,
  documents,
  pinnedId,
  viewerId,
  isLead,
  names,
}: {
  teamId: string;
  slug: string;
  /** Already without photos, pinned first, then newest first. */
  documents: CommunityResource[];
  pinnedId: string | null;
  viewerId: string;
  isLead: boolean;
  names: Record<string, string>;
}) {
  const { busy, error, run } = useDo();
  const panel = useTeamPanel();

  if (documents.length === 0) {
    return (
      <>
        <Empty icon={<Plus size={22} strokeWidth={1.75} aria-hidden />} text="Nothing shared yet. Add your slides, a paper, or a link.">
          <button
            type="button"
            onClick={() => panel.open("document")}
            className="inline-flex items-center gap-1 rounded-[10px] bg-[#0f6b33] px-[13px] py-2 text-[13px] font-bold leading-5 text-white hover:bg-[#0b3d22]"
          >
            <Plus size={18} strokeWidth={1.75} aria-hidden />
            Add a file
          </button>
        </Empty>
        <Err text={error} />
      </>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {documents.map((r) => {
          const kind = fileKind(r);
          const badge = BADGE[kind === "slides" || kind === "pdf" ? kind : "link"];
          const label = kind === "link" && r.files[0] ? "FILE" : badge.text;
          const first = r.files[0];
          const viewHref = first ? first.url : r.url;
          const pinned = r.id === pinnedId;
          const canRemove = isLead || r.added_by === viewerId;
          const items: MoreMenuItem[] = [];
          if (first) items.push({ label: "Download", href: downloadHref(first.url, first.filename) });
          for (const f of r.files.slice(1)) items.push({ label: `Download ${f.filename}`, href: downloadHref(f.url, f.filename) });
          if (isLead) {
            items.push({
              label: pinned ? "Unpin" : "Pin to the top",
              onClick: () => void run(r.id, () => pinCommunityResourceAction(teamId, pinned ? null : r.id, slug)),
            });
          }
          if (canRemove) {
            items.push({
              label: "Remove",
              danger: true,
              onClick: () => {
                if (window.confirm(`Remove "${r.title}" from the team?`)) {
                  void run(r.id, () => deleteCommunityResourceAction(teamId, r.id, slug));
                }
              },
            });
          }
          return (
            <li
              key={r.id}
              data-item-id={r.id}
              className={`rounded-2xl border border-[#e8e4da] bg-white overflow-hidden min-w-0 ${busy === r.id ? "opacity-50" : ""}`}
            >
              <div
                className="relative h-[120px] p-3.5 flex flex-col justify-end"
                style={{ background: kind === "slides" ? "linear-gradient(135deg,#e9f5ec,#d5ebdc)" : "#f1efe8" }}
              >
                <span
                  className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-extrabold leading-3 tracking-[0.08em] text-white"
                  style={{ background: badge.bg }}
                >
                  {label}
                  {pinned && <Pin size={11} strokeWidth={2} aria-label="Pinned" />}
                </span>
                <span className="absolute top-[13px] right-3 text-[11.5px] leading-4 text-[#6b6a64]">{typeLine(r)}</span>
                <p className="font-title text-[19px] leading-[1.2] text-[#1d1d1b] line-clamp-3 break-words">{r.title}</p>
              </div>
              <div className="flex items-center gap-2.5 px-3.5 py-3 border-t border-[#e8e4da]">
                <div className="min-w-0">
                  <b className="block text-[13.5px] leading-[18px] font-bold text-[#1d1d1b] truncate">
                    {names[r.added_by] ?? "A team member"}
                  </b>
                  <small className="block text-[11.5px] leading-4 text-[#6b6a64]">{shortDate(r.created_at)}</small>
                </div>
                {viewHref && (
                  <a
                    href={viewHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 rounded-[9px] bg-[#0f6b33] px-[13px] py-2 text-[12.5px] font-bold leading-4 text-white hover:bg-[#0b3d22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33] focus-visible:ring-offset-2"
                  >
                    View
                    <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
                  </a>
                )}
                <MoreMenu items={items} iconOnly className={viewHref ? "shrink-0" : "ml-auto shrink-0"} />
              </div>
            </li>
          );
        })}
      </ul>
      <Err text={error} />
    </>
  );
}
