"use client";

// Copy-link — any active member, not just admins (the point is members can
// bring people in themselves, without going through an admin's by-email
// add). Same copy-to-clipboard idiom as ShareButton
// (components/collaborate/CommunityPanel.tsx): build the absolute URL at
// click time from window.location.origin (a server component only knows
// the path, never the host it's served from here), copy it, flip to a
// "Link copied" confirmation for 2s, fail quietly if the Clipboard API is
// unavailable (older browser, non-secure context) — the link is still
// selectable text in the address bar either way.
//
// NO TOKEN, NO EXPIRY, NO INVITE TABLE — this is deliberately just the
// community's own URL (/communities/<slug>), the same URL anyone gets from
// the /communities list or a search engine. What a recipient sees when
// they open it (join directly if the community is open, "Request to join"
// if it's private) is existing behavior (JoinLeaveControl on this same
// page) — this component only ever copies text to the clipboard.

import { useState } from "react";

export default function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        const path = `/communities/${slug}`;
        const url = typeof window !== "undefined" ? window.location.origin + path : path;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard API can be unavailable — the link is still
          // selectable text in the URL bar, so failing quietly here
          // doesn't strand anyone.
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1.5"
    >
      <span className="material-symbols-outlined text-base">{copied ? "check" : "link"}</span>
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}
