"use client";

// Which action sheet is open on a team page, and the short "Slides added" toast
// after something is created. A tile opens a sheet; the "Add" buttons on the
// sections below open the same sheets, so the state lives here, above both.
//   open(p)          open a sheet
//   toggle(p)        a tile: open it, or close it if it is the open one
//   close()          close without a message
//   done(text, id?)  close, show the toast, and scroll to the new item (the
//                    element with data-item-id=<id>) once the refreshed page has it
//   notify(text)     the toast only (the sheet stays open)

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type TeamPanel = "document" | "photo" | "pages" | "share" | null;

type Ctx = {
  panel: TeamPanel;
  open: (p: Exclude<TeamPanel, null>) => void;
  toggle: (p: Exclude<TeamPanel, null>) => void;
  close: () => void;
  done: (text: string, itemId?: string) => void;
  notify: (text: string) => void;
};

const PanelCtx = createContext<Ctx | null>(null);

/** Wait (up to ~6 s) for the item to appear after router.refresh(), then scroll to
 *  it and flash it once. */
function scrollToItem(id: string) {
  const started = Date.now();
  const tick = () => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-item-id]")).find((e) => e.dataset.itemId === id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.animate?.(
        [{ boxShadow: "0 0 0 4px rgba(15,107,51,0.55)" }, { boxShadow: "0 0 0 4px rgba(15,107,51,0)" }],
        { duration: 1800, easing: "ease-out" }
      );
      return;
    }
    if (Date.now() - started < 6000) window.setTimeout(tick, 150);
  };
  window.setTimeout(tick, 250);
}

export function TeamPanelProvider({
  children,
  initialPanel = null,
}: {
  children: React.ReactNode;
  /** A panel to have open on arrival (a tile the visitor clicked before joining). */
  initialPanel?: TeamPanel;
}) {
  const [panel, setPanel] = useState<TeamPanel>(initialPanel);
  const [toast, setToast] = useState<{ n: number; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const open = useCallback((p: Exclude<TeamPanel, null>) => setPanel(p), []);
  const toggle = useCallback((p: Exclude<TeamPanel, null>) => setPanel((cur) => (cur === p ? null : p)), []);
  const close = useCallback(() => setPanel(null), []);

  const notify = useCallback((text: string) => {
    setToast((t) => ({ n: (t?.n ?? 0) + 1, text }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);
  const done = useCallback(
    (text: string, itemId?: string) => {
      setPanel(null);
      notify(text);
      if (itemId) scrollToItem(itemId);
    },
    [notify]
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <PanelCtx.Provider value={{ panel, open, toggle, close, done, notify }}>
      {children}
      {toast && (
        <div
          key={toast.n}
          role="status"
          aria-live="polite"
          className="fixed z-[90] left-1/2 -translate-x-1/2 bottom-[max(1.25rem,env(safe-area-inset-bottom))] max-w-[calc(100vw-32px)] rounded-full bg-[#1c1b17] text-white px-5 py-3 text-[14.5px] font-semibold leading-5 shadow-[0_8px_30px_rgba(0,0,0,0.3)] inline-flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px] text-[#6ee7a0]" aria-hidden>
            check_circle
          </span>
          {toast.text}
        </div>
      )}
    </PanelCtx.Provider>
  );
}

export function useTeamPanel(): Ctx {
  const c = useContext(PanelCtx);
  if (!c) throw new Error("useTeamPanel must be used inside TeamPanelProvider");
  return c;
}
