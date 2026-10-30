// Small "Invite code" badge — marks something that unlocks with an invite
// code. Links to /invite. Reusable sitewide; render it inside a card header
// or next to a title. Server-safe (no state), so it works in any component.

import Link from "next/link";

export default function Locked({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/invite"
      className={
        "inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-low text-primary " +
        "font-label-sm text-label-sm hover:bg-surface-container transition-colors whitespace-nowrap " +
        className
      }
    >
      <span className="material-symbols-outlined text-base leading-none">lock</span>
      Invite code
    </Link>
  );
}
