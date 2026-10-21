// "PINNED BY ADMIN" card on the community Home tab: a thumbnail (the first
// image file, else the resource type's icon), title, description and View /
// Download. Files are short-lived signed URLs minted per request; a signed-out
// visitor only gets any when the community is 'open' (see the pinned-resource
// migration), otherwise the resource itself isn't returned at all.

import type { CommunityResource } from "@/lib/server/communities";
import { downloadHref, isImageFile } from "@/lib/server/communityHome/communityHome";

const TYPE_ICON: Record<string, string> = {
  tool: "build",
  paper: "article",
  dataset: "database",
  slides: "slideshow",
  notes: "sticky_note_2",
  folder: "folder",
  template: "description",
  link: "link",
  podcast: "podcasts",
  other: "push_pin",
};

export default function PinnedResourceCard({ resource }: { resource: CommunityResource }) {
  const image = resource.files.find((f) => isImageFile(f.filename));
  const first = resource.files[0];
  const viewHref = first?.url ?? resource.url;
  const external = !first && !!resource.url;

  return (
    <section aria-label="Pinned by admin" className="rounded-2xl glass-panel p-5 flex flex-col gap-3">
      <span className="inline-flex items-center gap-1.5 font-label-sm text-label-sm tracking-widest text-primary">
        <span className="material-symbols-outlined text-[16px]">push_pin</span>
        PINNED BY ADMIN
      </span>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="w-full sm:w-36 h-28 sm:h-auto sm:min-h-28 shrink-0 rounded-xl bg-surface-container-low border border-outline-variant/30 overflow-hidden flex items-center justify-center">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-primary/60 text-5xl">
              {TYPE_ICON[resource.resource_type] ?? "push_pin"}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 flex flex-col gap-2">
          <h2 className="font-headline-sm text-headline-sm text-on-background break-words">{resource.title}</h2>
          {resource.description && (
            <p className="font-body-md text-body-md text-secondary line-clamp-3">{resource.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-auto pt-1">
            {viewHref && (
              <a
                href={viewHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary px-4 py-2 rounded-lg font-label-sm text-label-sm inline-flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">{external ? "open_in_new" : "visibility"}</span>
                View
              </a>
            )}
            {first && (
              <a
                href={downloadHref(first.url, first.filename)}
                className="btn-outline px-4 py-2 rounded-lg font-label-sm text-label-sm inline-flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download
              </a>
            )}
            {resource.files.length > 1 && (
              <span className="font-body-sm text-body-sm text-secondary">+{resource.files.length - 1} more file(s)</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
