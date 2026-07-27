// Inbox — /inbox. The responses people have sent to YOUR Collaborate posts.
//
// SERVER component, and a REDIRECT rather than a gate panel for a signed-out
// visitor: an inbox has nothing meaningful to show a stranger, so it follows
// /settings rather than /collaborate (see app/settings/page.tsx).
//
// Two enforcement layers, deliberately unequal in importance:
//   1. the redirect below — a courtesy, so nobody lands on a blank page;
//   2. inbox_requests(), which returns ONLY responses to posts the caller owns.
// (2) is the actual guarantee. Even if this page forgot to check, or a caller hit
// the RPC directly, the database still answers with their rows and nobody else's.
// Nothing here filters by user id, because nothing here needs to.

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listInbox } from "@/lib/server/inbox";
import InboxList from "@/components/inbox/InboxList";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata = { title: "Inbox · SDD Navigator" };

export default async function InboxPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Finbox");

  const requests = await listInbox();
  const unseen = requests.filter((r) => r.status === "new").length;

  return (
    <div className="max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <header className="mb-10">
        <h1 className="font-headline-lg text-headline-lg text-on-background">Inbox</h1>
        <p className="mt-3 font-body-lg text-body-lg text-secondary">
          {requests.length === 0
            ? "Responses to your Collaborate posts will appear here."
            : unseen > 0
              ? `${unseen} new ${unseen === 1 ? "response" : "responses"} to your posts.`
              : "Responses to your posts."}
        </p>
      </header>

      <InboxList requests={requests} />
    </div>
  );
}
