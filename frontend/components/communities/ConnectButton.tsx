"use client";

// "Connect" on another member's card — reveals their email as a mailto
// link, but only once clicked. The roster is member-gated, but rendering
// eleven addresses on page load regardless of whether anyone asked for
// them is a different exposure than someone deliberately reaching for one
// — see revealMemberEmailAction's own comment. Never rendered on the
// viewer's own card (MembersSection.tsx decides that, not this component).

import { useState } from "react";
import { revealMemberEmailAction } from "@/app/communities/actions";

export default function ConnectButton({
  communityId,
  memberId,
  compact = false,
}: {
  communityId: string;
  memberId: string;
  /** A small icon button for a compact row; the address shows after the click. */
  compact?: boolean;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (compact) {
    return (
      <div className="shrink-0 flex flex-col items-end min-w-0">
        {email ? (
          <a
            href={`mailto:${email}`}
            className="inline-flex items-center gap-1 max-w-[9rem] font-label-sm text-[12px] text-primary hover:underline"
            title={email}
          >
            <span className="material-symbols-outlined text-[16px]">mail</span>
            <span className="truncate">{email}</span>
          </a>
        ) : (
          <button
            type="button"
            disabled={loading}
            aria-label="Connect"
            title="Connect"
            onClick={async () => {
              setLoading(true);
              setError(null);
              const res = await revealMemberEmailAction(communityId, memberId);
              setLoading(false);
              if (res.ok) setEmail(res.email);
              else setError(res.error);
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="material-symbols-outlined text-[18px]">{loading ? "hourglass_empty" : "mail"}</span>
          </button>
        )}
        {error && <p className="font-body-sm text-[12px] text-error text-right">{error}</p>}
      </div>
    );
  }

  if (email) {
    return (
      <a
        href={`mailto:${email}`}
        className="mt-2 inline-flex items-center gap-1 font-label-sm text-label-sm text-primary hover:underline"
      >
        <span className="material-symbols-outlined text-sm">mail</span>
        {email}
      </a>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          const res = await revealMemberEmailAction(communityId, memberId);
          setLoading(false);
          if (res.ok) setEmail(res.email);
          else setError(res.error);
        }}
        className="inline-flex items-center gap-1 font-label-sm text-label-sm text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-sm">mail</span>
        {loading ? "Connecting…" : "Connect"}
      </button>
      {error && <p className="mt-1 font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  );
}
