"use client";

// Share buttons for a published article page. Plain share URLs with the
// article's own URL as a parameter — no SDK, no API, nothing that phones
// home to LinkedIn/Facebook/X before the user clicks. Copy link falls back
// to a hidden textarea the same way CopyButton in GeneratorPanel.tsx does,
// for browsers/contexts that block navigator.clipboard.
//
// LinkedIn is filled (btn-primary); Facebook, X and Copy link stay outline.
// Sharing to LinkedIn is the reason this feature exists — the four used to
// be visually identical grey outline buttons, which buried the one action
// this row is actually for.
//
// `layout="column"` — added for app/promote/[slug]/page.tsx's sticky rail
// (narrow, ~190px), which can't fit the default flex-wrap row of full-width
// pill buttons. Same links, same click handlers, same LinkedIn-is-primary
// rule; only the container direction and each button's own width change.
// `layout="row"` (default) is byte-for-byte the original markup — every
// other/future caller is unaffected.

import { useState } from "react";

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
  layout = "row",
}: {
  url: string;
  title: string;
  /** "row" (default) — the original flex-wrap pill row. "column" — stacked,
   *  full-width buttons for the sticky rail. */
  layout?: "row" | "column";
}) {
  const [copied, setCopied] = useState(false);
  const column = layout === "column";

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const links = [
    {
      label: "LinkedIn",
      icon: "share",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      primary: true,
    },
    {
      label: "Facebook",
      icon: "share",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      primary: false,
    },
    {
      label: "X",
      icon: "share",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
      primary: false,
    },
  ];

  return (
    <div className={column ? "flex flex-col items-stretch gap-2" : "flex flex-wrap items-center gap-3"}>
      <span
        className={
          column
            ? "font-label-sm text-label-sm text-secondary uppercase tracking-wide mb-1"
            : "font-label-md text-label-md text-secondary"
        }
      >
        Share
      </span>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg font-label-md text-label-md ${
            l.primary ? "btn-primary" : "btn-outline"
          } ${column ? "justify-center w-full" : ""}`}
        >
          <span className="material-symbols-outlined text-base">{l.icon}</span>
          {l.label}
        </a>
      ))}
      <button
        type="button"
        onClick={async () => {
          await copyToClipboard(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md ${
          column ? "justify-center w-full" : ""
        }`}
      >
        <span className="material-symbols-outlined text-base">
          {copied ? "check" : "link"}
        </span>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
