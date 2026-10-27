"use client";

// What someone who is not on the team sees: the members' layout (the hero with
// "Join this team", then the same six tiles with their counts). Nothing opens: a
// tile asks "Join this team to open this" and remembers what was tapped, so after
// joining (or signing in) the page opens it (?open=<kind>:<id>). The preview carries
// counts and titles only, never links, files or names.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { joinTeamAction } from "@/app/teams/actions";
import { ssoLoginAction } from "@/app/auth/actions";
import { setAssistantGate } from "@/lib/server/assistant/assistantBridge";
import { plural, teamReturnPath } from "@/lib/server/teams/teamRules";
import { openParam, type PreviewItem, type TeamPreview } from "@/lib/server/teams/teamPreview";
import { tileCount } from "@/lib/server/teams/teamUi";
import { ASSISTANT_ENABLED } from "@/lib/siteMode";
import { SECTION_ICON, SoftIcon, type SectionKey } from "./TeamIcons";

type Viewer = "signed_out" | "none";

type Gate = { ask: (open?: string) => void; viewer: Viewer; busy: boolean; error: string | null; go: (open?: string) => void };

const GateCtx = createContext<Gate | null>(null);
function useGate(): Gate {
  const g = useContext(GateCtx);
  if (!g) throw new Error("useGate must be used inside TeamPreview");
  return g;
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
  "relative text-center min-w-0 flex flex-col items-center basis-[calc((100%-20px)/3)] md:basis-[calc((100%-40px)/5)] grow-0 shrink-0 rounded-2xl border border-[#e8e4da] bg-white px-1.5 pt-4 pb-3.5 " +
  "transition-colors hover:border-[#0f6b33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f6b33] focus-visible:ring-offset-2";

/** The six tiles, as members see them. Each asks the visitor to sign in or join and
 *  remembers the section they clicked (?open=tile:<key>). */
function Tiles({ slides, pages, photos, people }: { slides: number; pages: number; photos: number; people: number }) {
  const { ask } = useGate();
  const tiles: { k: SectionKey; name: string; small: string; open?: string }[] = [
    { k: "slides", name: "Slides", small: tileCount("slides", slides), open: openParam("tile", "document") },
    { k: "learn", name: "Learn", small: tileCount("learn", pages), open: openParam("tile", "pages") },
    { k: "photos", name: "Photos", small: tileCount("photos", photos), open: openParam("tile", "share") },
    { k: "people", name: "People", small: tileCount("people", people) },
    // Only team leads make pages; a visitor is never one, so it is the question box.
    // Off on the teams site for now (assistantEnabled in lib/siteMode.ts).
    ...(ASSISTANT_ENABLED ? [{ k: "ask" as const, name: "Ask AI", small: "ask about the talk", open: openParam("tile", "learn") }] : []),
    { k: "share", name: "Share", small: "post a photo", open: openParam("tile", "share") },
  ];
  return (
    <div className="flex flex-wrap justify-center gap-2.5">
      {tiles.map((t) => (
        <button key={t.k} type="button" onClick={() => ask(t.open)} className={PREVIEW_TILE}>
          <SoftIcon icon={SECTION_ICON[t.k]} className="mb-[9px]" />
          <span className="block text-[14px] leading-[18px] font-bold text-[#1d1d1b]">{t.name}</span>
          <span className="block mt-0.5 text-[11.5px] leading-4 text-[#6b6a64]">{t.small}</span>
        </button>
      ))}
    </div>
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
            Join this team to open this
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
          {name} is private. Join to see its slides, learning pages, photos and people.
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
    if (!ASSISTANT_ENABLED) return;
    setAssistantGate(() => ask(openParam("tile", "learn")));
    return () => setAssistantGate(null);
  }, [ask]);

  return (
    <GateCtx.Provider value={{ ask, viewer, busy, error, go }}>
      <div className="flex flex-col gap-6">
        <Hero team={team} initialError={initialError} />
        <Tiles
          slides={team.documents.filter((d) => d.kind !== "image").length}
          pages={team.pages.length}
          photos={team.documents.filter((d) => d.kind === "image").length}
          people={team.member_count}
        />
      </div>
      {dialog && <Dialog name={team.name} open={dialog.open} onClose={() => setDialog(null)} />}
    </GateCtx.Provider>
  );
}
