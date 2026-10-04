// /invite — where every "Request invite code" button, "Request access" link
// and <Locked> badge lands. Server component: reads ?interest=<key> and passes
// the matching checkbox label to the client form to pre-tick. There is no code
// redemption here; invites are handled by hand for now.

import InviteForm from "@/components/invite/InviteForm";
import { interestFromParam } from "@/lib/inviteTypes";

const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ interest?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.interest) ? sp.interest[0] : sp.interest;
  const initialInterest = interestFromParam(raw);

  return (
    <section className="bg-gradient-to-b from-white to-surface-container-low min-h-[70vh]">
      <div className={`${WRAP} py-12 md:py-16`}>
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="text-center space-y-4">
            <span className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-4xl">lock_open</span>
            </span>
            <h1 className="font-display-lg text-display-lg md:text-[48px] md:leading-[1.1] text-on-background">
              Request an invite code
            </h1>
            <p className="font-body-lg text-body-lg text-secondary">
              The full network, project proposals and protected datasets unlock with an invite code.
              Tell us a little about you and we&apos;ll be in touch.
            </p>
          </div>
          <InviteForm initialInterest={initialInterest} />
        </div>
      </div>
    </section>
  );
}
