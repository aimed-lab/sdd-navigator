"use client";

// Share buttons for a published article page (and the owner's own editor
// preview — ArticleEditor.tsx). No SDK, no API, nothing that phones home to
// LinkedIn/Facebook/X before the user clicks.
//
// LINKEDIN IS A COPY-AND-PASTE HANDOFF, NOT A ONE-CLICK SHARE. LinkedIn
// removed the `text`/`summary` parameters from their share URL years ago —
// there is no query string that prefills a post's body, only the link
// preview. A real one-click "post this for me" needs OAuth, the
// w_member_social scope, and LinkedIn app review, none of which this feature
// has. So the LinkedIn button does the only honest thing available without
// that: copies the actual post text to the clipboard, THEN opens LinkedIn's
// own composer in a new tab (the same share-offsite dialog as before, which
// still accepts a URL and still has an editable text box the user can paste
// into). The button itself just says "LinkedIn" — what confirms the copy
// happened is the same after-the-click swap Copy link already uses (icon +
// label change, plus a one-line caption naming what to do next) — never a
// label that names both actions up front, and never anything implying this
// posts on the user's behalf.
//
// Facebook, X and Copy link are unchanged: plain share-intent URLs, no post
// text involved (those platforms never had this problem — the sharing
// contract this page still promises them is "share the article", not "share
// this exact post").
//
// Copy (both the LinkedIn post and the plain link) falls back to a hidden
// textarea the same way CopyButton in GeneratorPanel.tsx does, for
// browsers/contexts that block navigator.clipboard.
//
// `layout="column"` — added for app/promote/[slug]/page.tsx's sticky rail
// (narrow, ~190px), which can't fit the default flex-wrap row of full-width
// pill buttons. Same links, same click handlers, same LinkedIn-is-primary
// rule; only the container direction and each button's own width change.
// `layout="row"` (default) is byte-for-byte the original row shape.

import { useState } from "react";
import { withArticleLink } from "@/lib/articleFormat";

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
  linkedinPost,
  layout = "row",
}: {
  url: string;
  title: string;
  /** The LinkedIn post text, with a literal "{{ARTICLE_LINK}}" placeholder
   *  where the link goes (see showcaseTypes.ts:PublicArticle). Substituted
   *  for `url` before copying. Optional/empty for an entry created before
   *  this field existed — the LinkedIn button degrades to copying just the
   *  link in that case, same as it always did. */
  linkedinPost?: string;
  /** "row" (default) — the original flex-wrap pill row. "column" — stacked,
   *  full-width buttons for the sticky rail. */
  layout?: "row" | "column";
}) {
  const [copied, setCopied] = useState(false);
  const [copiedLinkedIn, setCopiedLinkedIn] = useState(false);
  const column = layout === "column";

  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
  const linkedinClipboardText = linkedinPost?.trim() ? withArticleLink(linkedinPost, url) : url;

  const otherLinks = [
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

  // Row layout: compact padding/text so all four buttons usually fit one
  // line, but `flex-wrap` (never `overflow-x-auto`) is what happens when a
  // narrower column can't fit them — a horizontal scrollbar inside a panel
  // is never the right answer; wrapping to a second row is.
  const buttonClass = column
    ? "justify-center w-full px-4 py-2"
    : "px-3 py-1.5 whitespace-nowrap";

  return (
    <div
      className={
        column ? "flex flex-col items-stretch gap-2" : "flex flex-wrap items-center gap-2"
      }
    >
      <span
        className={
          column
            ? "font-label-sm text-label-sm text-secondary uppercase tracking-wide mb-1"
            : "font-label-md text-label-md text-secondary shrink-0"
        }
      >
        Share
      </span>

      {/* LinkedIn is a copy-then-open handoff, not a one-click share — see
          the file header. The `onClick` doesn't preventDefault: the copy
          fires alongside the normal `<a target="_blank">` navigation, it
          doesn't block or replace it. Confirms after the click the same way
          Copy link does (icon + label swap), rather than naming both of its
          own actions up front. */}
      <div className={column ? "w-full" : "relative shrink-0"}>
        <a
          href={linkedinShareUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={async () => {
            await copyToClipboard(linkedinClipboardText);
            setCopiedLinkedIn(true);
            setTimeout(() => setCopiedLinkedIn(false), 4000);
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg font-label-md text-label-md btn-primary ${buttonClass}`}
        >
          <span className="material-symbols-outlined text-base">
            {copiedLinkedIn ? "check" : "share"}
          </span>
          {copiedLinkedIn ? "Copied" : "LinkedIn"}
        </a>
        {copiedLinkedIn && (
          <p
            role="status"
            className={`font-label-sm text-label-sm text-primary ${
              column ? "mt-1 text-center" : "absolute top-full left-0 mt-1 w-max max-w-[220px]"
            }`}
          >
            Paste it into the box LinkedIn just opened.
          </p>
        )}
      </div>

      {otherLinks.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 rounded-lg font-label-md text-label-md btn-outline ${buttonClass}`}
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
        className={`inline-flex items-center gap-1.5 rounded-lg btn-outline font-label-md text-label-md ${buttonClass}`}
      >
        <span className="material-symbols-outlined text-base">
          {copied ? "check" : "link"}
        </span>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
