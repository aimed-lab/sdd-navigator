"use client";

// A focused sheet: a bottom sheet on phones, a centered dialog from `md` up. The
// page behind is dimmed and does not scroll; Esc or a click on the dimmed area
// closes it; Tab stays inside it; focus goes back to what opened it. It is
// rendered in a portal on document.body, so no parent can clip or transform it.
// `useModal` is also used by the photo lightbox.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Esc closes, Tab is trapped inside `ref`, the page behind does not scroll, and
 *  focus returns to the opener when it closes. */
export function useModal(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const items = () => (root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement) : []);
    // First field (not the close button) when there is one, else the dialog itself.
    const first = root?.querySelector<HTMLElement>("input, textarea, select") ?? items()[0] ?? root;
    window.setTimeout(() => first?.focus({ preventScroll: true }), 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const a = list[0];
      const z = list[list.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === a || cur === root)) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && cur === z) {
        e.preventDefault();
        a.focus();
      } else if (root && cur && !root.contains(cur)) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}

/** Render children into document.body once we are in the browser. */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export default function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Portal>
      <SheetBody title={title} onClose={onClose}>
        {children}
      </SheetBody>
    </Portal>
  );
}

function SheetBody({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full md:max-w-xl max-h-[92dvh] md:max-h-[88dvh] flex flex-col bg-white rounded-t-[20px] md:rounded-[20px] shadow-[0_-8px_40px_rgba(0,0,0,0.25)] outline-none pb-[env(safe-area-inset-bottom)]"
      >
        <div className="md:hidden flex justify-center pt-2" aria-hidden>
          <span className="w-10 h-1 rounded-full bg-[#d9d5c9]" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-3 md:pt-5 border-b border-[#efece3]">
          <h2 className="font-headline-sm text-[20px] leading-7 text-on-background">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container-low hover:text-on-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
