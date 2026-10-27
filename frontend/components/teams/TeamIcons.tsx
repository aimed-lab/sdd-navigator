// The line icons of the team page (Lucide, like the CFDE app) and the soft green
// rounded square they sit in. Used on the team page only; the rest of the site
// keeps Material Symbols. Brand green #0f6b33 on soft green #e9f5ec.

import { BookOpen, Camera, Presentation, Share2, Sparkles, Users, type LucideIcon } from "lucide-react";

export const GREEN = "#0f6b33";
export const SOFT_GREEN = "#e9f5ec";

export type SectionKey = "slides" | "learn" | "photos" | "people" | "ask" | "share";

export const SECTION_ICON: Record<SectionKey, LucideIcon> = {
  slides: Presentation,
  learn: BookOpen,
  photos: Camera,
  people: Users,
  ask: Sparkles,
  share: Share2,
};

/** An icon in a soft green rounded square. size: the square's side in px. */
export function SoftIcon({
  icon: Icon,
  size = 46,
  iconSize = 24,
  on = false,
  className = "",
}: {
  icon: LucideIcon;
  size?: number;
  iconSize?: number;
  /** On a tile that is already soft green, the square turns white. */
  on?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`grid place-items-center shrink-0 ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: on ? "#ffffff" : SOFT_GREEN, color: GREEN, border: on ? "1px solid #e8e4da" : undefined }}
      aria-hidden
    >
      <Icon size={iconSize} strokeWidth={1.75} />
    </span>
  );
}
