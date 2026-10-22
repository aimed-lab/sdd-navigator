"use client";

// Share buttons for a published article (and the author's editor preview): No
// SDK, no API, nothing that phones home to a platform before the click.
//
//   - X and Bluesky open their compose window already filled with the item's
//     ready-to-post text (under 280 characters, link included).
//   - LinkedIn cannot prefill a post: its share link accepts only the URL. So
//     the button copies the LinkedIn text to the clipboard, says "Text copied,
//     paste it into LinkedIn", and opens LinkedIn's share dialog in a new tab.
//   - Copy link copies the page address.
//
// Every link is built from the site URL config (lib/articleFormat.ts), passed in
// as `url`, never a hardcoded host. The texts keep "{{ARTICLE_LINK}}" where the
// link goes; fillLink() puts the real URL in at click time.
//
// Copy falls back to a hidden textarea for browsers that block navigator.clipboard.

import { useState } from "react";
import {
  blueskyComposeUrl,
  fillLink,
  linkedinShareUrl,
  xComposeUrl,
  type ShareTexts,
} from "@/lib/server/promote/shareText";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to the textarea fallback below
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* nothing more we can do */
  }
  document.body.removeChild(ta);
}

export default function ShareButtons({
  url,
  title,
  shareText,
  layout = "row",
}: {
  url: string;
  title: string;
  /** The per-platform drafts (editable on the edit page). A blank one falls
   *  back to the headline and link. */
  shareText: ShareTexts;
  /** "row" (default): a wrapping row. "column": stacked, for the sidebar. */
  layout?: "row" | "column";
}) {
  const [copied, setCopied] = useState(false);
  const [copiedLinkedIn, setCopiedLinkedIn] = useState(false);
  const column = layout === "column";

  const linkedinText = shareText.linkedin.trim() ? fillLink(shareText.linkedin, url) : `${title}\n\n${url}`;
  const shortFallback = `${title.slice(0, 200)}\n\n${url}`;
  const xText = shareText.x.trim() ? fillLink(shareText.x, url) : shortFallback;
  const blueskyText = shareText.bluesky.trim() ? fillLink(shareText.bluesky, url) : shortFallback;

  const buttonClass = column ? "justify-center w-full px-4 py-2" : "px-3 py-1.5 whitespace-nowrap";

  return (
    <div className={column ? "flex flex-col items-stretch gap-2" : "flex flex-wrap items-center gap-2"}>
      <span
        className={
          column
            ? "font-label-sm text-label-sm text-secondary uppercase tracking-wide mb-1"
            : "font-label-md text-label-md text-secondary shrink-0"
        }
      >
        Share
      </span>

      <div className={column ? "w-full" : "relative shrink-0"}>
        <a
          href={linkedinShareUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={async () => {
            // The copy runs alongside the normal new-tab navigation.
            await copyToClipboard(linkedinText);
            setCopiedLinkedIn(true);
            setTimeout(() => setCopiedLinkedIn(false), 5000);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg font-label-md text-label-md btn-primary ${buttonClass}`}
        >
          <span className="material-symbols-outlined text-base">{copiedLinkedIn ? "check" : "share"}</span>
          LinkedIn
        </a>
        {copiedLinkedIn && (
          <p
            role="status"
            className={`font-label-sm text-label-sm text-primary ${
              column ? "mt-1 text-center" : "absolute top-full left-0 mt-1 w-max max-w-[240px]"
            }`}
          >
            Text copied, paste it into LinkedIn.
          </p>
        )}
      </div>

      <a
        href={blueskyComposeUrl(blueskyText)}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 rounded-lg font-label-md text-label-md btn-outline ${buttonClass}`}
      >
        <span className="material-symbols-outlined text-base">share</span>
        Bluesky
      </a>
      <a
        href={xComposeUrl(xText)}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 rounded-lg font-label-md text-label-md btn-outline ${buttonClass}`}
      >
        <span className="material-symbols-outlined text-base">share</span>
        X
      </a>
      <button
        type="button"
        onClick={async () => {
          await copyToClipboard(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className={`inline-flex items-center gap-1.5 rounded-lg btn-outline font-label-md text-label-md ${buttonClass}`}
      >
        <span className="material-symbols-outlined text-base">{copied ? "check" : "link"}</span>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
