"use client";

// "News & promote": a team lead posts a short team news item (the community
// announcements table), and anyone on the team can open Promote's create flow
// with the team attached, so the item gets the share buttons.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAnnouncementAction } from "@/app/communities/actions";

const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function NewsPanel({
  teamId,
  slug,
  isLead,
  onClose,
}: {
  teamId: string;
  slug: string;
  isLead: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Give the news a short title.");
    setBusy(true);
    setError(null);
    const res = await createAnnouncementAction(teamId, slug, { title, body });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
    onClose();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {isLead ? (
        <form onSubmit={post} className="flex flex-col gap-3">
          <h3 className="font-label-lg text-label-lg text-on-background">Post team news</h3>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Short title"
            aria-label="News title"
            className={INPUT}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="A sentence or two (optional)"
            aria-label="News text"
            className={`${INPUT} resize-y`}
          />
          {error && (
            <p className="font-body-sm text-body-sm text-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {busy ? "Posting…" : "Post news"}
            </button>
            <button type="button" onClick={onClose} className="font-label-md text-label-md text-secondary hover:text-on-background">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="font-label-lg text-label-lg text-on-background">Post team news</h3>
          <p className="font-body-md text-body-md text-secondary">
            Only a team lead can post news. Ask a lead, or share a result on the right.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-label-lg text-label-lg text-on-background">Share a photo or result</h3>
        <p className="font-body-md text-body-md text-secondary">
          Opens the Promote form with this team attached, so you get ready-made share buttons.
        </p>
        <Link
          href={`/promote/submit?community=${teamId}`}
          className="btn-outline self-start px-5 py-2.5 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[18px]">share</span>
          Share a photo or result
        </Link>
      </div>
    </div>
  );
}
