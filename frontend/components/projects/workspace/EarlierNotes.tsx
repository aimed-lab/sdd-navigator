// "Earlier notes": the August project wiki (wiki_notes), shown read only in the
// Wiki tab when a project has any. Nothing here edits or deletes them; the old
// graph view stays at /projects/[id]/wiki.

import Link from "next/link";
import type { WikiNoteSummary } from "@/lib/server/wikiNotes";

function teaser(body: string): string {
  const t = body.replace(/\s+/g, " ").replace(/[#*_`>\[\]]/g, "").trim();
  return t.length > 160 ? `${t.slice(0, 157).trimEnd()}...` : t;
}

export default function EarlierNotes({ projectId, notes }: { projectId: string; notes: WikiNoteSummary[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 max-w-3xl">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-headline-sm text-headline-sm text-on-background">Earlier notes</h2>
        <Link
          href={`/projects/${projectId}/wiki`}
          className="font-label-sm text-label-sm text-primary hover:underline underline-offset-4 shrink-0"
        >
          Open the earlier wiki
        </Link>
      </div>
      <p className="font-body-sm text-body-sm text-secondary">
        Notes written by the project agent before wiki pages existed. They are kept as they were and cannot be edited here.
      </p>
      <ul className="flex flex-col gap-2">
        {notes.slice(0, 10).map((n) => (
          <li key={n.id} className="rounded-xl bg-surface-container-low/60 p-4">
            <p className="font-label-md text-label-md text-on-background">{n.title}</p>
            {n.body && <p className="mt-1 font-body-sm text-body-sm text-secondary">{teaser(n.body)}</p>}
          </li>
        ))}
      </ul>
      {notes.length > 10 && (
        <p className="font-body-sm text-body-sm text-secondary">and {notes.length - 10} more in the earlier wiki</p>
      )}
    </section>
  );
}
