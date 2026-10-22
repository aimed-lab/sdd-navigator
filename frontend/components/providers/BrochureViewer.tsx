"use client";

// "Their brochure": every page as a thumbnail; a click opens it full size in a
// lightbox. Keyboard: Esc closes, left/right arrows move between pages. There
// is also a visible Close button.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

export default function BrochureViewer({ pages, company }: { pages: string[]; company: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setIndex(null);
    openerRef.current?.focus();
  }, []);
  const step = useCallback(
    (d: number) => setIndex((i) => (i === null ? i : (i + d + pages.length) % pages.length)),
    [pages.length]
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [index, close, step]);

  if (pages.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {pages.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={(e) => {
              openerRef.current = e.currentTarget;
              setIndex(i);
            }}
            aria-label={`Open brochure page ${i + 1} of ${pages.length}`}
            className="tile relative aspect-[3/4] overflow-hidden bg-white border border-outline-variant/30"
          >
            <Image src={src} alt={`${company} brochure, page ${i + 1}`} fill sizes="200px" className="object-cover object-top" />
          </button>
        ))}
      </div>

      {index !== null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${company} brochure, page ${index + 1} of ${pages.length}`}
          onClick={close}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/90 text-on-background hover:bg-white"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          {pages.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous page"
                className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 text-on-background hover:bg-white"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Next page"
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 text-on-background hover:bg-white"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pages[index]}
            alt={`${company} brochure, page ${index + 1}`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain rounded-lg bg-white"
          />
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white font-label-sm text-label-sm">
            {index + 1} / {pages.length}
          </p>
        </div>
      )}
    </>
  );
}
