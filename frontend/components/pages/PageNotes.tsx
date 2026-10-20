// The notes of a living page: each one a section (title + body). [n] in a body
// is a numbered citation that links to the cited evidence; [[Note Title]]
// links to another note on the page. A citation the page cannot resolve stays
// plain text. Server component.

import SectionHeading from "@/components/explore/SectionHeading";
import type { PageNoteView } from "@/lib/server/pages/pageView";
import { parseNoteBody, type EvidenceRow } from "@/lib/server/pages/pageViewHelpers";

export default function PageNotes({ notes, evidence }: { notes: PageNoteView[]; evidence: EvidenceRow[] }) {
  if (notes.length === 0) return null;
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const slugByTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n.slug]));

  return (
    <section>
      <SectionHeading title="Notes" />
      <div className="flex flex-col gap-10 max-w-3xl">
        {notes.map((note) => {
          const citeMap = new Map(Object.entries(note.citations).map(([n, id]) => [Number(n), id]));
          const paragraphs = parseNoteBody(note.body, citeMap, slugByTitle);
          const cited = Array.from(citeMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([n, id]) => ({ n, item: evidenceById.get(id) }))
            .filter((c): c is { n: number; item: EvidenceRow } => !!c.item);

          return (
            <article key={note.id} id={`note-${note.slug}`} className="scroll-mt-24">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-title text-[24px] leading-tight font-medium text-on-background">{note.title}</h3>
                {note.is_human_edited && (
                  <span className="font-label-sm text-label-sm text-secondary">
                    {note.editedByViewer ? "Edited by you" : "Edited by a person"}
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {paragraphs.map((parts, i) => (
                  <p key={i} className="font-body-md text-body-md text-on-background leading-relaxed">
                    {parts.map((part, j) => {
                      if (part.type === "text") return <span key={j}>{part.text}</span>;
                      if (part.type === "notelink") {
                        return part.slug ? (
                          <a key={j} href={`#note-${part.slug}`} className="text-primary hover:underline underline-offset-4">
                            {part.title}
                          </a>
                        ) : (
                          <span key={j}>{part.title}</span>
                        );
                      }
                      const item = evidenceById.get(part.itemId ?? "");
                      return item?.url ? (
                        <a
                          key={j}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={item.title}
                          className="align-super text-[11px] text-primary hover:underline"
                        >
                          [{part.n}]
                        </a>
                      ) : (
                        <sup key={j} className="text-[11px] text-secondary" title={item?.title}>
                          [{part.n}]
                        </sup>
                      );
                    })}
                  </p>
                ))}
              </div>
              {cited.length > 0 && (
                <ol className="mt-4 flex flex-col gap-1 font-body-sm text-body-sm text-secondary">
                  {cited.map(({ n, item }) => (
                    <li key={n}>
                      <span className="mr-1">[{n}]</span>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary hover:underline underline-offset-4"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
