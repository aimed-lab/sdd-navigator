// The green "← Back to <team>" (or "← My teams") link at the top of a wiki page on the
// teams site. On a phone it stays pinned right under the top bar, always visible at
// the top of the page. Server-safe.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PageBackLink } from "@/lib/server/teams/teamRules";

export default function TeamBackLink({ link }: { link: PageBackLink }) {
  return (
    <div className="sticky top-16 z-30 bg-[#fbfaf7]/95 backdrop-blur border-b border-[#e7e4dc] md:static md:bg-transparent md:backdrop-blur-none md:border-b-0">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-3 md:pt-6 md:pb-0">
        <Link
          href={link.href}
          className="inline-flex items-center gap-1.5 text-[14px] font-semibold leading-5 text-[#0f6b33] hover:text-[#0b3d22] hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33] rounded"
        >
          <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
          {link.label}
        </Link>
      </div>
    </div>
  );
}
