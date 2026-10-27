"use client";

// What someone who is not on the team sees: the same layout members see (hero,
// the tiles, the wiki-page and document shelves) with titles and type icons
// only, and the people as a count. Nothing opens. Every click asks them to sign
// in (or join, if they are signed in) and remembers what they clicked, so after
// that the page opens it (?open=<kind>:<id>).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { joinTeamAction } from "@/app/teams/actions";
import { ssoLoginAction } from "@/app/auth/actions";
import { setAssistantGate } from "@/lib/server/assistant/assistantBridge";
import { plural, teamReturnPath } from "@/lib/server/teams/teamRules";
import { openParam, type PreviewItem, type TeamPreview } from "@/lib/server/teams/teamPreview";
import { tileCount } from "@/lib/server/teams/teamUi";
import { SECTION_ICON, SoftIcon, type SectionKey } from "./TeamIcons";

type Viewer = "signed_out" | "none";

type Gate = { ask: (open?: string) => void; viewer: Viewer; busy: boolean; error: string | null; go: (open?: string) => void };

const GateCtx = createContext<Gate | null>(null);
function useGate(): Gate {
  const g = useContext(GateCtx);
  if (!g) throw new Error("useGate must be used inside TeamPreview");
  return g;
}

const CARD = "rounded-2xl border border-[#e8e4da] bg-white p-5 flex flex-col gap-4 shadow-[0_1px_2px_rgba(40,36,28,0.05)] min-w-0";
const ROW_BTN =
  "w-full flex items-center gap-3 min-w-0 py-3 border-t border-[#efece3] first:border-t-0 first:pt-0 last:pb-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md";

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="font-headline-sm text-[20px] leading-7 text-on-background flex items-center gap-2 min-w-0">
        <span className="truncate">{title}</span>
        {count !== undefined && (
          <span className="shrink-0 rounded-full bg-[#f1efe8] px-2 py-0.5 text-[12px] font-semibold leading-4 text-secondary">
            {count}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

/** The one button that gets someone in: sign in (SSO) when signed out, join when signed in. */
function JoinButton({ open, className = "" }: { open?: string; className?: string }) {
  const { viewer, busy, go } = useGate();
  return (
    <button
      type="button"
      onClick={() => go(open)}
      disabled={busy}
      className={`btn-primary px-5 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 ${className}`}
    >
      {busy ? (viewer === "none" ? "Joining…" : "Opening sign-in…") : "Join this team"}
    </button>
  );
}

function Hero({ team, initialError }: { team: TeamPreview; initialError: string | null }) {
  const { viewer, error } = useGate();
  const shownError = error ?? initialError;
  return (
    <header
      className="relative rounded-[20px] text-white overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0b3d22, #0f6b33 60%, #1f8a4a)" }}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-6 p-5 sm:p-7">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <span className="text-[12px] leading-5 font-semibold tracking-[0.14em] text-white/80">TEAM · PRIVATE</span>
          <h1 className="font-headline-lg text-[28px] sm:text-[32px] leading-[1.2] text-white break-words">{team.name}</h1>
          {team.description && <p className="font-body-lg text-[16px] leading-6 text-white/90 break-words">{team.description}</p>}
          <span className="text-[14px] leading-5 text-white/90 pt-1">{plural(team.member_count, "member")}</span>
        </div>
        <div className="rounded-xl bg-white text-on-background p-4 flex flex-col gap-3 lg:w-72">
          <JoinButton />
          {viewer === "signed_out" && (
            <p className="font-body-sm text-body-sm text-secondary">New here? Sign in or create an account in one step.</p>
          )}
          {shownError && (
            <p className="font-body-sm text-body-sm text-error" role="alert">
              {shownError}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}

const PREVIEW_TILE =
  "relative text-center w-full min-w-0 flex flex-col items-center rounded-2xl border border-[#e8e4da] bg-white px-1.5 pt-4 pb-3.5 " +
  "transition-colors hover:border-[#0f6b33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33] focus-visible:ring-offset-2";

/** The six tiles, as members see them. Each asks the visitor to sign in or join and
 *  remembers the section they clicked (?open=tile:<key>). */
function Tiles({ slides, pages, people }: { slides: number; pages: number; people: number }) {
  const { ask } = useGate();
  const tiles: { k: SectionKey; name: string; small: string; open?: string }[] = [
    { k: "slides", name: "Slides", small: tileCount("slides", slides), open: openParam("tile", "document") },
    { k: "learn", name: "Learn", small: tileCount("learn", pages), open: openParam("tile", "pages") },
    { k: "photos", name: "Photos", small: "", open: openParam("tile", "share") },
    { k: "people", name: "People", small: tileCount("people", people) },
    { k: "ask", name: "Ask AI", small: "make a page", open: openParam("tile", "learn") },
    { k: "share", name: "Share", small: "post a photo", open: openParam("tile", "share") },
  ];
  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
      {tiles.map((t) => (
        <button key={t.k} type="button" onClick={() => ask(t.open)} className={PREVIEW_TILE}>
          <SoftIcon icon={SECTION_ICON[t.k]} className="mb-[9px]" />
          <span className="block text-[14px] leading-[18px] font-bold text-[#1d1d1b]">{t.name}</span>
          {t.small && <span className="block mt-0.5 text-[11.5px] leading-4 text-[#6b6a64]">{t.small}</span>}
        </button>
      ))}
    </div>
  );
}

function PagesCard({ pages }: { pages: PreviewItem[] }) {
  const { ask } = useGate();
  return (
    <Card title="Team wiki pages" count={pages.length}>
      {pages.length === 0 ? (
        <p className="font-body-md text-[14px] leading-[1.5] text-secondary">No wiki pages yet.</p>
      ) : (
        <ul>
          {pages.map((p) => (
            <li key={p.id}>
              <button type="button" className={ROW_BTN} onClick={() => ask(openParam("page", p.id))}>
                <SoftIcon icon={SECTION_ICON.learn} size={36} iconSize={18} />
                <span className="min-w-0 flex-1 font-label-lg text-[15px] leading-6 font-semibold text-on-background break-words">
                  {p.title}
                </span>
                <span className="material-symbols-outlined text-secondary text-[18px] shrink-0" aria-hidden>
                  lock
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocumentsCard({ documents }: { documents: PreviewItem[] }) {
  const { ask } = useGate();
  return (
    <Card title="Shared documents" count={documents.length}>
      {documents.length === 0 ? (
        <p className="font-body-md text-[14px] leading-[1.5] text-secondary">Nothing shared yet.</p>
      ) : (
        <ul>
          {documents.map((d) => {
            return (
              <li key={d.id}>
                <button type="button" className={ROW_BTN} onClick={() => ask(openParam("doc", d.id))}>
                  <SoftIcon icon={d.kind === "image" ? SECTION_ICON.photos : SECTION_ICON.slides} size={36} iconSize={18} />
                  <span className="min-w-0 flex-1 font-label-lg text-[15px] leading-6 font-semibold text-on-background break-words">
                    {d.title}
                  </span>
                  <span className="material-symbols-outlined text-secondary text-[18px] shrink-0" aria-hidden>
                    lock
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Dialog({ name, onClose, open }: { name: string; onClose: () => void; open: string | undefined }) {
  const { viewer } = useGate();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { error } = useGate();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/45" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 flex flex-col gap-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="gate-title" className="font-headline-sm text-[20px] leading-7 text-on-background">
            Sign in to get access
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <p className="font-body-md text-body-md text-secondary break-words">
          Join {name} to open slides, papers and learning pages.
        </p>
        <GateButton open={open} buttonRef={ref} viewer={viewer} />
        {error && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function GateButton({
  open,
  buttonRef,
  viewer,
}: {
  open: string | undefined;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  viewer: Viewer;
}) {
  const { busy, go } = useGate();
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => go(open)}
      disabled={busy}
      className="btn-primary px-5 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
    >
      {busy ? (viewer === "none" ? "Joining…" : "Opening sign-in…") : viewer === "none" ? "Join this team" : "Sign in or create an account"}
    </button>
  );
}

export default function TeamPreviewView({
  slug,
  team,
  viewer,
  initialError,
}: {
  slug: string;
  team: TeamPreview;
  viewer: Viewer;
  initialError: string | null;
}) {
  const [dialog, setDialog] = useState<{ open: string | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback((open?: string) => setDialog({ open }), []);

  // Sign in (SSO) and come back to this team with what was clicked, or, when
  // already signed in, join now and open it.
  const go = useCallback(
    async (open?: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      if (viewer === "none") {
        const res = await joinTeamAction(slug);
        if (!res.ok) {
          setError(res.error);
          setBusy(false);
          return;
        }
        window.location.assign(`/teams/${slug}${open ? `?open=${open}` : ""}`);
        return;
      }
      const res = await ssoLoginAction(teamReturnPath(slug, open));
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      window.location.assign(res.url);
    },
    [busy, slug, viewer]
  );

  // The floating "Ask AI assistant" button asks too, instead of opening.
  useEffect(() => {
    setAssistantGate(() => ask(openParam("tile", "learn")));
    return () => setAssistantGate(null);
  }, [ask]);

  return (
    <GateCtx.Provider value={{ ask, viewer, busy, error, go }}>
      <div className="flex flex-col gap-6">
        <Hero team={team} initialError={initialError} />
        <Tiles slides={team.documents.length} pages={team.pages.length} people={team.member_count} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
            <PagesCard pages={team.pages} />
            <DocumentsCard documents={team.documents} />
          </div>
          <div className="flex flex-col gap-6 min-w-0">
            <Card title="People">
              <p className="font-body-md text-body-md text-secondary">{plural(team.member_count, "member")}</p>
            </Card>
          </div>
        </div>
      </div>
      {dialog && <Dialog name={team.name} open={dialog.open} onClose={() => setDialog(null)} />}
    </GateCtx.Provider>
  );
}
