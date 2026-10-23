"use client";

// "More (⋯)" for the owner on a Promote item's own page: Edit and Delete. The
// delete uses the same confirm as the cards and goes back to /promote with a
// "Deleted" message.

import { useState } from "react";
import MoreMenu from "@/components/MoreMenu";
import DeleteShowcaseConfirm from "./DeleteShowcaseConfirm";

export default function OwnerMenu({ id, slug, title }: { id: string; slug: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <MoreMenu
        className="ml-auto shrink-0"
        buttonClassName="!text-on-primary bg-white/15 hover:!bg-white/25 !px-4 !py-2"
        items={[
          { label: "Edit", href: `/promote/${slug}/edit` },
          { label: "Delete", danger: true, onClick: () => setConfirming(true) },
        ]}
      />
      {confirming && <DeleteShowcaseConfirm entryId={id} entryTitle={title} onClose={() => setConfirming(false)} />}
    </>
  );
}
