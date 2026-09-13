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
}: {
  communityId: string;
  memberId: string;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
