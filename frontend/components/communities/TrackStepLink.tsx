"use client";

// A plain link that also records a welcome-checklist step for the signed-in
// member when clicked (fire and forget: the link opens regardless).

import { markOnboardingStepAction } from "@/app/communities/actions";

export default function TrackStepLink({
  communityId,
  step,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { communityId: string; step: "pinned_opened" | "link_copied" }) {
  return (
    <a
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        void markOnboardingStepAction(communityId, step);
      }}
    >
      {children}
    </a>
  );
}
