// /invite — where every "Request invite code" button, "Request access" link
// and <Locked> badge lands. Server component: reads ?interest=<key> and passes
// the matching checkbox label to the client form to pre-tick. There is no code
// redemption here; invites are handled by hand for now.

import InviteForm from "@/components/invite/InviteForm";
import PageHeader, { PageShell } from "@/components/PageHeader";
import { interestFromParam } from "@/lib/inviteTypes";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ interest?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.interest) ? sp.interest[0] : sp.interest;
  const initialInterest = interestFromParam(raw);

  return (
    <PageShell narrow className="space-y-8">
      <PageHeader
        title="Request an invite code"
        subtitle="The full network, project proposals and protected datasets unlock with an invite code. Tell us a little about you and we'll be in touch."
        className="mb-0"
      />
      <InviteForm initialInterest={initialInterest} />
    </PageShell>
  );
}
