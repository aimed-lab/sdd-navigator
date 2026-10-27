// The notes of a wiki page: each one a section (title + body). [n] in a body
// is a numbered citation that links to the cited evidence; [[Note Title]]
// links to another note on the page. A citation the page cannot resolve stays
// plain text. Server component.

import SectionHeading from "@/components/explore/SectionHeading";
import type { PageNoteView } from "@/lib/server/pages/pageView";
import { parseNoteBody, type EvidenceRow } from "@/lib/server/pages/pageViewHelpers";
import { editedByLabel } from "@/lib/server/pages/pageEditCore";
import AddSection from "./AddSection";
import NoteSection from "./NoteSection";

export default function PageNotes({
  notes,
  evidence,
  pageId,
  pageSlug,
  canEdit = false,
  isOwner = false,
}: {
  notes: PageNoteView[];
  evidence: EvidenceRow[];
  pageId: string;
  pageSlug: string;
  /** May the viewer edit sections and add one (owner, page editor, project member)? */
  canEdit?: boolean;
  /** Only the owner may delete a section. */
  isOwner?: boolean;
}) {
  if (notes.length === 0 && !canEdit) return null;
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
            <NoteSection
              key={note.id}
              pageId={pageId}
              pageSlug={pageSlug}
              noteId={note.id}
              noteSlug={note.slug}
              title={note.title}
              body={note.body}
              // "Edited by ..." is for people who can edit the page; readers do not see it.
              editedLabel={
                canEdit
                  ? editedByLabel({
                      isHumanEdited: note.is_human_edited,
                      editedByViewer: note.editedByViewer,
                      name: note.editedByName,
                    })
                  : null
              }
              canEdit={canEdit}
              isOwner={isOwner}
            >
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
            </NoteSection>
          );
        })}
        {canEdit && <AddSection pageId={pageId} pageSlug={pageSlug} />}
      </div>
    </section>
  );
}
