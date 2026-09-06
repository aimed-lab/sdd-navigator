"use client";

// Share buttons for a published article page. Plain share URLs with the
// article's own URL as a parameter — no SDK, no API, nothing that phones
// home to LinkedIn/Facebook/X before the user clicks. Copy link falls back
// to a hidden textarea the same way CopyButton in GeneratorPanel.tsx does,
// for browsers/contexts that block navigator.clipboard.

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

export default function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const links = [
    {
      label: "LinkedIn",
      icon: "share",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    },
    {
      label: "Facebook",
      icon: "share",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      label: "X",
      icon: "share",
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-label-md text-label-md text-secondary">Share</span>
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md"
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
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md"
      >
        <span className="material-symbols-outlined text-base">
          {copied ? "check" : "link"}
        </span>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
