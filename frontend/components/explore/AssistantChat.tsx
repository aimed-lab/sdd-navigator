"use client";

// The AI assistant side panel: a research assistant that answers first and
// offers pages second.
//
// - A floating "Ask AI assistant" button (bottom right) opens the panel on the
//   right: 500px by default, resizable by dragging its left edge (380-720px,
//   remembered), or full width with Expand. On desktop the page content is
//   pushed left (globals.css, keyed off html[data-assistant-open] and the
//   --assistant-w variable); on mobile the panel fills the screen under the
//   nav, so the nav and its account menu stay reachable.
// - Mounted once in the root layout, so the chat stays while the researcher
//   moves between Explore and the /pages screens; offered on those routes only.
// - Each answer reads top to bottom: the question, what was searched (with real
//   counts), the cited answer, numbered source cards, quick facts, a one-time
//   "save as a wiki page" offer, and related questions. The main page follows
//   the search the BACKEND says it ran (/explore/<query>).
// - The Private / Team / Public picker is shown straight away only when the
//   researcher says what they work on or asks for a page; otherwise "Save page"
//   in the offer box opens it.
//
// SAFETY PATTERN (same as the project agent): the model only PROPOSES. The
// reply can carry an `action`; this component shows a confirm card, and only
// when the user clicks Create does it call POST /api/pages, with the signed-in
// user's own session. Nothing the model says is executed directly, and
// everything it returns is validated first (parseAssistantReply).
//
// Signed-out users can chat. Creating needs sign-in: at Create the chat is
// saved to sessionStorage and the user is sent to /login with this page as the
// callback, then the conversation (and the pending confirm card) comes back.

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  CHAT_STORAGE_KEY,
  CHOICE_INFO,
  GREETING,
  STARTERS,
  VISIBILITIES,
  assistantAvailableOn,
  exploreQueryFromPath,
  parseAssistantReply,
  restoreChat,
  serializeChat,
  type ChatMessage,
  type CreatePageAction,
  type Visibility,
} from "@/lib/server/assistant/assistantReply";
import {
  PROGRESS_SEARCH,
  PROGRESS_THINK,
  clampPanelWidth,
  countChips,
  countResults,
  followUpsFor,
  isPagePick,
  parseMarkdown,
  resolveTopic,
  shouldShowPicker,
  pickResultCards,
  quickFacts,
  sourcesToCards,
  stripChoiceText,
  topicFromMessage,
  type AnswerExtras,
  type FactRow,
  type Inline,
  type ResultCard,
} from "@/lib/server/assistant/assistantAnswer";
import type { ExploreResponse, ExploreSection } from "@/types/explore";
import { TeamDraftCard, TeamListCard, type TeamListState } from "@/components/explore/TeamAssistantCards";
import { detectTeamIntent, teamDraftReply, teamListReply, type TeamIntent } from "@/lib/server/assistant/teamIntent";
import { listMyTeamsAction } from "@/app/teams/actions";
import { createCommunityAction, joinCommunityAction } from "@/app/communities/actions";
import { ASSISTANT_EVENT, getPageTeam, parseAssistantRequest, type AssistantRequest, type AssistantTeam } from "@/lib/server/assistant/assistantBridge";
import { canCreateCommunityAction } from "@/app/communities/actions";
import { TEAM_VISIBLE_NOTE, teamSlugFromPath, teamTopicFromMessage } from "@/lib/server/teams/teamRules";
import {
  afterDuplicateChoice,
  needsEarlyDuplicateCheck,
  newCommunityMessage,
  isCommunityTurn,
  pageKey,
  type CreateCommunityAction,
} from "@/lib/server/assistant/assistantReply";
import type { CommunityMatch } from "@/lib/server/assistant/communityMatch";
import CommunityMatches, { type JoinProgress, type MatchesState } from "./CommunityMatches";
import CommunityDraft, { type DraftStage } from "./CommunityDraft";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  // "early": found as soon as Public was picked (before the confirm card);
  // "late": found at the last step, after Create was clicked (the fallback).
  | { kind: "duplicate"; slug: string; title: string; stage: "early" | "late" }
  | { kind: "collecting" }
  | { kind: "done"; slug: string; visibility: Visibility }
  | { kind: "error"; message: string };

/** What a searched answer carries. Kept with the chat in sessionStorage. */
type Extras = AnswerExtras;

const RESULTS_ANCHOR = "explore-results";
const WIDTH_KEY = "sdd.assistant.width";
const DEFAULT_WIDTH = 500;

async function fetchSections(topic: string): Promise<ExploreSection[] | null> {
  try {
    const res = await fetch("/api/explore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: topic }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ExploreResponse;
    return Array.isArray(json?.sections) ? json.sections : null;
  } catch {
    return null;
  }
}

export function Inlines({ items, maxCite }: { items: Inline[]; maxCite: number }) {
  return (
    <>
      {items.map((n, i) =>
        n.t === "bold" ? (
          <strong key={i} className="font-semibold">
            {n.v}
          </strong>
        ) : n.t === "cite" ? (
          n.n >= 1 && n.n <= maxCite ? (
            <span
              key={i}
              title={`Source ${n.n}`}
              className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 mx-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold align-text-top"
            >
              {n.n}
            </span>
          ) : null
        ) : n.t === "link" ? (
          <a
            key={i}
            href={n.href}
            target={n.href.startsWith("/") ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 break-words"
          >
            {n.v}
          </a>
        ) : (
          <Fragment key={i}>{n.v}</Fragment>
        )
      )}
    </>
  );
}

export function Markdown({ text, maxCite }: { text: string; maxCite: number }) {
  return (
    <div className="flex flex-col gap-3">
      {parseMarkdown(text).map((b, i) =>
        b.t === "p" ? (
          <p key={i}>
            <Inlines items={b.inlines} maxCite={maxCite} />
          </p>
        ) : b.t === "ul" ? (
          <ul key={i} className="list-disc pl-5 flex flex-col gap-1">
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines items={it} maxCite={maxCite} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal pl-5 flex flex-col gap-1">
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines items={it} maxCite={maxCite} />
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}

function SourceCards({
  cards,
  more,
  total,
  narrow,
  onSeeAll,
}: {
  cards: ResultCard[];
  /** Results beyond the cards; null when the count is unknown. */
  more: number | null;
  total: number | null;
  narrow: boolean;
  onSeeAll: () => void;
}) {
  const seeAll = more === null || more > 0 || (total ?? 0) > 0;
  return (
    // A grid, never a sideways scroll: 3 cards + "See all" in one row, or two
    // per row when the panel is narrow (or on a phone).
    <div className={"grid gap-2 " + (narrow ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
      {cards.map((c, i) => {
        const body = (
          <>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-4 h-4 rounded-full bg-primary text-on-primary text-[10px] font-semibold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <span
                className="px-1.5 py-0.5 rounded-full font-label-sm text-[10px] leading-tight truncate"
                style={{ background: `var(--type-${c.tint}-bg)`, color: `var(--type-${c.tint}-fg)` }}
              >
                {c.tag}
              </span>
            </span>
            <span className="font-label-sm text-label-sm text-on-background leading-snug line-clamp-3 break-words">
              {c.title}
            </span>
          </>
        );
        const cls =
          "flex flex-col gap-1.5 p-2.5 min-w-0 rounded-xl bg-white border border-outline-variant/30 shadow-[0_1px_2px_rgba(25,28,30,0.04)] ";
        return c.url ? (
          <a
            key={c.id}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={c.detail || c.title}
            className={cls + "hover:border-primary/60 hover:-translate-y-px transition-all"}
          >
            {body}
          </a>
        ) : (
          <div key={c.id} title={c.detail || c.title} className={cls}>
            {body}
          </div>
        );
      })}
      {seeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="flex flex-col items-start justify-center gap-0.5 p-2.5 min-w-0 rounded-xl border border-dashed border-primary/50 bg-primary/5 text-primary hover:bg-primary/10 transition-colors text-left"
        >
          {more !== null && more > 0 && <span className="font-title text-[22px] leading-none">+{more}</span>}
          <span className="font-label-sm text-label-sm">See all results</span>
        </button>
      )}
    </div>
  );
}

function Picker({ onPick, busy }: { onPick: (v: Visibility) => void; busy: boolean }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Page type">
      {VISIBILITIES.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          disabled={busy}
          className={
            "text-left px-4 py-3 rounded-xl border transition-all disabled:opacity-50 " +
            (v === "private"
              ? "border-primary bg-primary/5"
              : "border-outline-variant/40 bg-white hover:border-primary")
          }
        >
          <span className="font-label-md text-label-md text-on-background">{CHOICE_INFO[v].label}</span>
          <span className="block font-body-sm text-body-sm text-secondary">{CHOICE_INFO[v].line}</span>
        </button>
      ))}
    </div>
  );
}

export default function AssistantChat() {
  const pathname = usePathname();
  const router = useRouter();
  const query = exploreQueryFromPath(pathname);
  const { user, loading: authLoading } = useAuth();

  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Index of the assistant message the Private / Team / Public picker sits under.
  const [pickerAt, setPickerAt] = useState<number | null>(null);
  const [extras, setExtras] = useState<Record<number, Extras>>({});
  const [action, setAction] = useState<CreatePageAction | null>(null);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [progress, setProgress] = useState<string[]>(PROGRESS_THINK);
  const [progressStep, setProgressStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [restored, setRestored] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  // True once a page has been created in this chat.
  const [pageCreated, setPageCreated] = useState(false);
  // Communities: the match cards under an assistant message, what the join
  // buttons did, whether the matches were shown in this chat (the backend
  // refuses to draft a community before that), and the draft being edited.
  const [cards, setCards] = useState<Record<number, MatchesState>>({});
  const [joinProgress, setJoinProgress] = useState<Record<string, JoinProgress>>({});
  const [communitiesChecked, setCommunitiesChecked] = useState(false);
  const [draft, setDraft] = useState<CreateCommunityAction | null>(null);
  const [draftStage, setDraftStage] = useState<DraftStage>("edit");
  const [autoSend, setAutoSend] = useState<string | null>(null);
  // "Make learning material" on a team page: the page made next is added to
  // this team. Cleared by New chat or by a request from anywhere else.
  const [team, setTeam] = useState<AssistantTeam | null>(null);
  // Whether the page just made was added to that team (null: no team involved).
  const [teamAdded, setTeamAdded] = useState<boolean | null>(null);
  // Whether the signed-in person is a site admin (only they may start a
  // community; everyone else's draft becomes a team). Asked when a draft opens.
  const [siteAdmin, setSiteAdmin] = useState<boolean | null>(null);
  const [draftKind, setDraftKind] = useState<"team" | "community" | null>(null);
  // Team commands ("create a team", "my teams") are answered here, never searched:
  // the card under an assistant message, and the list once it is fetched.
  const [teamCards, setTeamCards] = useState<Record<number, TeamIntent>>({});
  const [teamLists, setTeamLists] = useState<Record<number, TeamListState>>({});
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Topics the save-as-a-page offer was already shown for in this chat.
  const offered = useRef<Set<string>>(new Set());
  // Bumped by New chat so a search still in flight cannot write into the new chat.
  const chatId = useRef(0);
  // The proposed page whose public-page check was already settled by the researcher.
  const skipDup = useRef<string | null>(null);

  const available = assistantAvailableOn(pathname);
  // The assistant is for signed-in people. Signed out, the button still shows
  // and the panel only offers sign-in (the API routes refuse with 401 anyway).
  const signedOut = !authLoading && !user;

  // The team a page made now is added to: the one the tile attached, else the
  // team whose page is open (a message typed by hand there).
  const pageSlug = teamSlugFromPath(pathname);
  const activeTeam = (): AssistantTeam | null => {
    if (team && (!pageSlug || team.slug === pageSlug)) return team;
    const t = getPageTeam();
    return pageSlug && t && t.slug === pageSlug ? t : null;
  };
  const shownTeam = activeTeam();

  // Restore the conversation (e.g. after the sign-in round trip) and the width.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) setWidth(clampPanelWidth(saved, window.innerWidth));
    } catch {
      // localStorage can be unavailable (private mode, blocked); keep the default.
    }
    try {
      const snap = restoreChat(window.sessionStorage.getItem(CHAT_STORAGE_KEY));
      if (snap) {
        setMessages(snap.messages);
        setPickerAt(snap.choices ? snap.messages.length - 1 : null);
        setAction(snap.action);
        if (snap.communityDraft) {
          setDraft(snap.communityDraft);
          setDraftStage("confirm"); // they still have to click Create
        }
        if (snap.communitiesChecked) setCommunitiesChecked(true);
        if (snap.extras) {
          // Source cards, quick facts and related questions come back with the chat.
          setExtras(snap.extras);
          Object.values(snap.extras).forEach((x) => offered.current.add(x.query.toLowerCase()));
        }
        setOpen(true);
      }
    } catch {
      // sessionStorage can be unavailable (private mode, blocked); start fresh.
    }
    setRestored(true);
  }, []);

  // Keep the snapshot current. Cleared once a page has been created.
  useEffect(() => {
    if (!restored) return;
    try {
      const communityDone = typeof draftStage === "object" && "done" in draftStage;
      if (messages.length === 0 || phase.kind === "done" || communityDone) {
        window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(
          CHAT_STORAGE_KEY,
          serializeChat({
            messages,
            choices: pickerAt !== null ? VISIBILITIES : null,
            action,
            communityDraft: draft,
            communitiesChecked,
            extras,
          })
        );
      }
    } catch {
      // Not worth surfacing; the chat just won't survive a reload.
    }
  }, [restored, messages, pickerAt, action, phase.kind, draft, draftStage, communitiesChecked, extras]);

  // Tell the page the panel is open and how wide, so it can make room.
  useEffect(() => {
    const root = document.documentElement;
    if (open && available) {
      root.dataset.assistantOpen = expanded ? "expanded" : "true";
      root.style.setProperty("--assistant-w", expanded ? "0px" : `${width}px`);
    } else {
      delete root.dataset.assistantOpen;
      root.style.removeProperty("--assistant-w");
    }
    return () => {
      delete root.dataset.assistantOpen;
      root.style.removeProperty("--assistant-w");
    };
  }, [open, available, expanded, width]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, typing, action, pickerAt, phase, extras]);

  // Focus the input when the panel opens, after each reply and after New chat.
  useEffect(() => {
    if (open && !typing) inputRef.current?.focus();
  }, [open, typing, focusTick]);

  // Progress text while waiting: step through the stages, then hold the last.
  useEffect(() => {
    if (!typing) return;
    setProgressStep(0);
    const timers = progress.slice(1).map((_, i) => window.setTimeout(() => setProgressStep(i + 1), 4000 * (i + 1)));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [typing, progress]);

  const fitInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };
  useEffect(fitInput, [input]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || typing || !user) return;
    // The search is whatever the backend reports it ran; until then, a guess
    // (used only to pick the progress text, and by an older backend).
    const next: ChatMessage[] = [...messages, { role: "user", content }];

    // A clear team command: answer it here. No backend call, no search, no
    // page move, no Save page, no Related questions.
    const teamIntent = detectTeamIntent(content);
    if (teamIntent) {
      const index = next.length;
      setInput("");
      setPickerAt(null);
      setAction(null);
      setDraft(null);
      setPhase({ kind: "idle" });
      setError(null);
      if (teamIntent.kind === "create") {
        setMessages([...next, { role: "assistant", content: teamDraftReply(teamIntent.name) }]);
        setTeamCards((c) => ({ ...c, [index]: teamIntent }));
      } else {
        setMessages([...next, { role: "assistant", content: "Here are your teams." }]);
        setTeamCards((c) => ({ ...c, [index]: teamIntent }));
        setTeamLists((l) => ({ ...l, [index]: "loading" }));
        const chat = chatId.current;
        void listMyTeamsAction().then((res) => {
          if (chat !== chatId.current) return;
          const state: TeamListState = !res.ok
            ? { error: res.error }
            : res.signedIn
              ? { signedIn: true, teams: res.teams }
              : { signedIn: false };
          setTeamLists((l) => ({ ...l, [index]: state }));
          if (res.ok && res.signedIn) {
            setMessages((m) => m.map((x, i) => (i === index ? { ...x, content: teamListReply(res.teams.length) } : x)));
          } else if (res.ok) {
            setMessages((m) => m.map((x, i) => (i === index ? { ...x, content: "Sign in to see your teams." } : x)));
          }
        });
      }
      return;
    }
    // A community request (or the answer to "which topic?") is not an Explore
    // search: no panel search, no page move, no cards / facts / Save page / Related.
    const communityTurn = isCommunityTurn(next);
    const guess = communityTurn ? "" : topicFromMessage(content);
    setMessages(next);
    setInput("");
    setPickerAt(null);
    setAction(null);
    setDraft(null);
    setDraftStage("edit");
    setPhase({ kind: "idle" });
    setError(null);
    setProgress(guess ? PROGRESS_SEARCH : PROGRESS_THINK);
    setTyping(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          context: {
            ...(query ? { query } : {}),
            ...(pageCreated ? { page_created: true } : {}),
            ...(communitiesChecked ? { communities_checked: true } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const parsed = parseAssistantReply(await res.json());
      if (!parsed) throw new Error("unusable reply");

      // The search the main page follows: the backend's own query, else the
      // message's own topic (an older backend sends none). Whatever happens to
      // the panel's search below, the page still moves to the topic.
      // A community step is not an Explore search: the page stays where it is.
      // On a team page the topic is only what follows "about:" (never the team
      // name), and the page stays on the team: no jump to Explore.
      const onTeam = !!activeTeam() || !!pageSlug;
      const topic = parsed.community || communityTurn
        ? ""
        : onTeam
          ? teamTopicFromMessage(content)
          : resolveTopic({ content, backendQuery: parsed.query });
      if (!onTeam && topic && topic.toLowerCase() !== query.toLowerCase()) {
        router.push(`/explore/${encodeURIComponent(topic)}`);
      }

      // The reply never carries the page-type question or the three options as
      // text, whatever the backend sent; the picker carries that choice.
      const reply = stripChoiceText(parsed.reply) || "Here is what I found.";
      const index = next.length;
      setMessages([...next, { role: "assistant", content: reply }]);
      setAction(parsed.action ?? null);
      // The picker straight away only when they said what they work on or asked
      // for a page. Backend `choices` and a failed search never decide it.
      setPickerAt(!parsed.community && !communityTurn && shouldShowPicker(content, !!parsed.action) ? index : null);

      // A public page is checked against existing public pages right away,
      // before the confirm card appears.
      if (parsed.action && needsEarlyDuplicateCheck(parsed.action)) void checkEarly(parsed.action);

      if (parsed.community?.type === "find_communities") {
        void showMatches(index, parsed.community.query);
      } else if (parsed.community?.type === "create_community") {
        setDraft(parsed.community);
        setDraftStage("edit");
      }

      if (topic) {
        const key = topic.toLowerCase();
        const offerSave = !offered.current.has(key);
        offered.current.add(key);
        const fromBackend = sourcesToCards(parsed.sources);
        const base: Extras = {
          query: topic,
          chips: [],
          cards: fromBackend,
          total: null,
          facts: [],
          related: parsed.related ?? [],
          offerSave,
        };
        // The answer is on screen now; the panel's own search fills in the
        // counts, facts and (for an older backend) cards when it arrives. If it
        // fails the answer, the page move and "See all results" still stand.
        setExtras((prev) => ({ ...prev, [index]: base }));
        const chat = chatId.current;
        void fetchSections(topic).then((sections) => {
          if (chat !== chatId.current) return; // New chat started meanwhile
          setExtras((prev) => ({
            ...prev,
            [index]: {
              ...base,
              chips: countChips(sections),
              cards: fromBackend.length > 0 ? fromBackend : pickResultCards(sections, 3, topic),
              total: sections ? countResults(sections) : null,
              facts: quickFacts(sections, topic),
              related: parsed.related ?? followUpsFor(sections, topic).map((f) => f.text),
            },
          }));
        });
      }
    } catch {
      setError("The assistant isn't available right now. Please try again.");
    } finally {
      setTyping(false);
    }
  };

  // A button elsewhere on the page (Explore) hands the panel a message: open,
  // then send it as the researcher's turn or fill the input.
  const [external, setExternal] = useState<AssistantRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const req = parseAssistantRequest((e as CustomEvent).detail);
      if (req) setExternal(req);
    };
    window.addEventListener(ASSISTANT_EVENT, on);
    return () => window.removeEventListener(ASSISTANT_EVENT, on);
  }, []);
  useEffect(() => {
    if (!external || !restored || typing || authLoading) return;
    const req = external;
    setExternal(null);
    // Signed out: just open the panel, which asks them to sign in. Nothing is sent.
    if (!user) {
      setOpen(true);
      return;
    }
    setTeam(req.team ?? null);
    setOpen(true);
    if (req.mode === "open") setFocusTick((t) => t + 1);
    else if (req.mode === "send") void send(req.text);
    else {
      // For a team page the prompt ends "about: " so the topic can be typed straight after.
      setInput(req.team ? `${req.text} ` : req.text);
      setFocusTick((t) => t + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, restored, typing, authLoading, user]);

  // A draft needs to know who is asking: only site admins may start a
  // community, so everyone else's draft is a team.
  useEffect(() => {
    if (!draft || siteAdmin !== null) return;
    let live = true;
    void canCreateCommunityAction().then((r) => live && setSiteAdmin(r.siteAdmin));
    return () => {
      live = false;
    };
  }, [draft, siteAdmin]);

  // After the matches showed there were none, go straight to the draft.
  useEffect(() => {
    if (autoSend && !typing) {
      const text = autoSend;
      setAutoSend(null);
      void send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, typing]);

  const showMatches = async (index: number, topic: string) => {
    const chat = chatId.current;
    setCards((prev) => ({
      ...prev,
      [index]: { query: topic, loading: true, failed: false, signedIn: !!user, matches: [] },
    }));
    let matches: CommunityMatch[] = [];
    let signedIn = !!user;
    let failed = false;
    try {
      const res = await fetch(`/api/communities/match?q=${encodeURIComponent(topic)}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      signedIn = json?.signedIn === true;
      matches = (Array.isArray(json?.matches) ? json.matches : []).filter(
        (m: unknown): m is CommunityMatch =>
          !!m && typeof m === "object" && typeof (m as CommunityMatch).id === "string" && typeof (m as CommunityMatch).slug === "string" && typeof (m as CommunityMatch).name === "string"
      );
    } catch {
      failed = true;
    }
    if (chat !== chatId.current) return; // New chat started meanwhile
    setCards((prev) => ({ ...prev, [index]: { query: topic, loading: false, failed, signedIn, matches } }));
    if (failed) return;
    setCommunitiesChecked(true);
    if (matches.length === 0) setAutoSend(newCommunityMessage(topic));
  };

  const joinMatch = async (m: CommunityMatch) => {
    if (!user) {
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(pathname + window.location.search)}`);
      return;
    }
    setJoinProgress((p) => ({ ...p, [m.id]: "busy" }));
    const res = await joinCommunityAction(m.id, m.isOpen, m.slug);
    setJoinProgress((p) => ({ ...p, [m.id]: res.ok ? (m.isOpen ? "active" : "pending") : { error: res.error } }));
  };

  const createCommunityNow = async () => {
    if (!draft) return;
    if (!user) {
      // Chat and draft are in sessionStorage (effect above); come back to this page.
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(pathname + window.location.search)}`);
      return;
    }
    // Not a site admin: a team. A site admin picks (the draft card asks).
    const kind = siteAdmin ? draftKind : "team";
    if (!kind) {
      setDraftStage({ error: "Choose a team or a community first." });
      return;
    }
    setDraftStage("creating");
    const res = await createCommunityAction({ name: draft.name, purpose: draft.purpose, kind });
    setDraftKind(kind);
    setDraftStage(res.ok ? { done: res.slug } : { error: res.error });
  };

  const checkEarly = async (a: CreatePageAction) => {
    const chat = chatId.current;
    setPhase({ kind: "checking" });
    let match: { slug: string; title: string } | null = null;
    try {
      const res = await fetch(`/api/pages/similar?title=${encodeURIComponent(a.title)}&seed=${encodeURIComponent(a.seed_input)}`);
      const json = res.ok ? await res.json() : null;
      if (json?.match?.slug) match = { slug: json.match.slug, title: json.match.title };
    } catch {
      // The check is a courtesy; if it fails the last-step check still runs.
    }
    if (chat !== chatId.current) return;
    setPhase(match ? { kind: "duplicate", slug: match.slug, title: match.title, stage: "early" } : { kind: "idle" });
  };

  const createPage = async (a: CreatePageAction, skipDuplicateCheck = false) => {
    if (!user) {
      // Chat is already in sessionStorage (effect above); come back to this page.
      const back = pathname + (typeof window !== "undefined" ? window.location.search : "");
      window.location.assign(`/login?callbackUrl=${encodeURIComponent(back)}`);
      return;
    }

    if (a.visibility === "public" && !skipDuplicateCheck && skipDup.current !== pageKey(a)) {
      setPhase({ kind: "checking" });
      try {
        const res = await fetch(
          `/api/pages/similar?title=${encodeURIComponent(a.title)}&seed=${encodeURIComponent(a.seed_input)}`
        );
        const json = res.ok ? await res.json() : null;
        if (json?.match?.slug) {
          setPhase({ kind: "duplicate", slug: json.match.slug, title: json.match.title, stage: "late" });
          return;
        }
      } catch {
        // The check is a courtesy; if it fails, carry on and create.
      }
    }

    setPhase({ kind: "collecting" });
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: a.seed_input,
          title: a.title,
          visibility: a.visibility,
          ...(activeTeam() ? { team_id: activeTeam()!.id } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.slug !== "string") {
        throw new Error(typeof json?.error === "string" ? json.error : "Couldn't create the page.");
      }
      setAction(null);
      setPickerAt(null);
      setPageCreated(true);
      const addedTo = activeTeam();
      setTeamAdded(addedTo ? json?.team?.added === true : null);
      // Still on the team page: re-read it so the new page shows under Team wiki pages.
      if (addedTo && json?.team?.added === true && pageSlug === addedTo.slug) router.refresh();
      setPhase({ kind: "done", slug: json.slug, visibility: a.visibility });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Couldn't create the page." });
    }
  };

  const change = () => {
    setAction(null);
    setPhase({ kind: "idle" });
    setPickerAt(messages.length - 1);
  };

  const reset = () => {
    setMessages([]);
    setExtras({});
    setPickerAt(null);
    setAction(null);
    setPhase({ kind: "idle" });
    setError(null);
    setPageCreated(false);
    setCards({});
    setJoinProgress({});
    setCommunitiesChecked(false);
    setDraft(null);
    setDraftKind(null);
    setTeam(null);
    setTeamCards({});
    setTeamLists({});
    setDraftStage("edit");
    setAutoSend(null);
    skipDup.current = null;
    setInput("");
    offered.current = new Set();
    chatId.current += 1;
    setFocusTick((t) => t + 1);
  };

  const pickStarter = (st: (typeof STARTERS)[number]) => {
    if (st.kind === "soon") return;
    if (st.kind === "go") {
      router.push(st.href);
      return;
    }
    if (st.kind === "send") {
      void send(st.text);
      return;
    }
    setInput(st.text);
    setFocusTick((t) => t + 1);
  };

  const closeOnPhone = () => {
    if (typeof window !== "undefined" && window.innerWidth < 640) setOpen(false);
  };

  const seeAll = () => {
    // On a phone the panel covers the page, so close it to show the results.
    closeOnPhone();
    window.setTimeout(() => {
      document.getElementById(RESULTS_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  // Drag the left edge to resize (desktop). The width is kept in localStorage.
  const dragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let latest = width;
    const move = (ev: PointerEvent) => {
      latest = clampPanelWidth(window.innerWidth - ev.clientX, window.innerWidth);
      setWidth(latest);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      try {
        window.localStorage.setItem(WIDTH_KEY, String(latest));
      } catch {
        // Not worth surfacing; the width just won't be remembered.
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // Enough room in the header for the whole subtitle and the button labels.
  const roomy = expanded || width >= 470;

  const busy = typing || phase.kind === "checking" || phase.kind === "collecting";

  if (!available) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask AI assistant"
          className="fixed right-6 bottom-24 max-sm:right-4 max-sm:bottom-[calc(68px+var(--fb-clear,0px))] z-[56] h-12 px-5 max-sm:w-12 max-sm:px-0 max-sm:justify-center rounded-full btn-primary shadow-lg flex items-center gap-2 font-label-md text-label-md"
        >
          <span className="material-symbols-outlined text-[20px] max-sm:text-[24px]">auto_awesome</span>
          <span className="max-sm:hidden">Ask AI assistant</span>
        </button>
      )}
      {open && (
        // z-40 sits under the nav (z-50) so its account menu always opens on top.
        <aside
          aria-label="AI assistant"
          style={{ "--assistant-panel-w": expanded ? "100vw" : `${width}px` } as CSSProperties}
          className="fixed z-40 top-16 bottom-0 left-0 right-0 sm:left-auto sm:w-[var(--assistant-panel-w)] bg-[#fbfaf7] sm:border-l border-outline-variant/40 shadow-2xl flex flex-col"
        >
          {!expanded && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize assistant"
              onPointerDown={dragStart}
              className="hidden sm:block absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-10 hover:bg-primary/20 active:bg-primary/30 transition-colors"
            />
          )}

          <div className="flex items-center justify-between gap-3 px-5 py-3 bg-white border-b border-outline-variant/30">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
              </span>
              {/* flex-1 + min-w-0 + truncate: the text takes whatever room the
                  buttons leave and is cut with an ellipsis, so it never runs
                  underneath them at any panel width. */}
              <div className="min-w-0 flex-1">
                <h2 className="font-title text-[20px] leading-tight font-medium text-on-background truncate">
                  Research assistant
                </h2>
                <p className="font-body-sm text-[12px] leading-tight text-secondary truncate">
                  Searches 12 sources · cites everything
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-pressed={expanded}
                aria-label={expanded ? "Collapse" : "Expand"}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm text-secondary hover:text-primary hover:bg-primary/5"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {expanded ? "close_fullscreen" : "open_in_full"}
                </span>
                {roomy && (expanded ? "Collapse" : "Expand")}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={messages.length === 0}
                aria-label="New chat"
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm text-secondary hover:text-primary hover:bg-primary/5 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-secondary"
              >
                <span className="material-symbols-outlined text-[18px]">edit_square</span>
                {roomy && "New chat"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-primary/5"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {signedOut ? (
            <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto px-5 py-8">
              <p className="font-title text-[22px] leading-snug text-on-background">
                Sign in to use the assistant. It can find research, make wiki pages and create teams for you.
              </p>
              <a
                href={`/login?callbackUrl=${encodeURIComponent(
                  pathname + (typeof window !== "undefined" ? window.location.search : "")
                )}`}
                className="btn-primary self-start px-6 py-2.5 rounded-lg font-label-md text-label-md"
              >
                Sign in
              </a>
            </div>
          ) : (
            <>
          <div className="flex-1 min-h-0 flex flex-col gap-5 overflow-y-auto px-5 py-5" aria-live="polite">
            {messages.length === 0 && (
              <div className="flex flex-col gap-3">
                <p className="font-title text-[22px] leading-snug text-on-background">{GREETING}</p>
                <div className="flex flex-col gap-2" role="group" aria-label="Starters">
                  {STARTERS.map((st) =>
                    st.kind === "soon" ? (
                      <button
                        key={st.id}
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="text-left px-4 py-3 rounded-xl border border-outline-variant/30 bg-surface-container-low opacity-50 cursor-not-allowed"
                      >
                        <span className="font-label-md text-label-md text-secondary">{st.label}</span>
                      </button>
                    ) : (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => pickStarter(st)}
                        className="text-left px-4 py-3 rounded-xl border border-outline-variant/40 bg-white hover:border-primary transition-all"
                      >
                        <span className="font-label-md text-label-md text-on-background">{st.label}</span>
                        {st.hint && <span className="block font-body-sm text-body-sm text-secondary">{st.hint}</span>}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              if (m.role === "user") {
                // A page-type pick is a small reply, not a new question.
                return isPagePick(m.content) || detectTeamIntent(m.content) ? (
                  <div
                    key={i}
                    className="self-end px-4 py-2 rounded-2xl rounded-br-md bg-primary/10 text-on-background font-body-md text-body-md"
                  >
                    {m.content}
                  </div>
                ) : (
                  <h3 key={i} className="font-title text-[24px] leading-snug font-medium text-on-background break-words">
                    {m.content}
                  </h3>
                );
              }
              const ex = extras[i];
              return (
                <div key={i} className="flex flex-col gap-4">
                  {ex && ex.chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" aria-label="What was searched">
                      {ex.chips.map((c) => (
                        <span
                          key={c.kind}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm"
                        >
                          <span aria-hidden="true">✓</span>
                          {c.text}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    {ex && (
                      <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">Answer</span>
                    )}
                    <div className="font-body-md text-body-md text-on-background leading-relaxed">
                      <Markdown text={m.content} maxCite={ex ? ex.cards.length : 0} />
                    </div>
                  </div>

                  {teamCards[i]?.kind === "create" && (
                    <TeamDraftCard
                      initialName={(teamCards[i] as Extract<TeamIntent, { kind: "create" }>).name}
                      signedIn={!!user}
                      authLoading={authLoading}
                      onCreated={() => router.refresh()}
                    />
                  )}
                  {teamCards[i]?.kind === "list" && teamLists[i] && <TeamListCard state={teamLists[i]} />}

                  {/* The assistant's sentence first, then the matches it introduces. */}
                  {cards[i] && (
                    <CommunityMatches
                      state={cards[i]}
                      progress={joinProgress}
                      busy={busy}
                      loginHref={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
                      onJoin={joinMatch}
                      onCreateNew={() => void send(newCommunityMessage(cards[i].query))}
                    />
                  )}

                  {ex && (
                    <SourceCards
                      cards={ex.cards}
                      more={ex.total === null ? null : Math.max(0, ex.total - ex.cards.length)}
                      total={ex.total}
                      narrow={!expanded && width < 520}
                      onSeeAll={seeAll}
                    />
                  )}

                  {ex && ex.facts.length > 0 && (
                    <div className="rounded-xl border border-outline-variant/30 bg-white overflow-hidden">
                      <p className="px-3.5 pt-2.5 pb-1 font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">
                        Quick facts
                      </p>
                      <ul className="divide-y divide-outline-variant/20">
                        {ex.facts.map((f) => (
                          <li key={f.kind}>
                            <Link
                              href={`/explore/${encodeURIComponent(ex.query)}?category=${f.kind}`}
                              onClick={closeOnPhone}
                              className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-primary/5 transition-colors"
                            >
                              <span className="w-[84px] shrink-0 font-label-md text-label-md text-on-background">
                                {f.label}
                              </span>
                              <span className="flex-1 min-w-0 font-body-sm text-body-sm text-secondary line-clamp-2">
                                {f.text}
                              </span>
                              <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-[11px]">
                                {f.count}
                              </span>
                              <span className="material-symbols-outlined text-[16px] text-secondary">chevron_right</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {ex && pickerAt === i && !typing && (
                    <Picker onPick={(v) => send(CHOICE_INFO[v].label)} busy={busy} />
                  )}
                  {ex && ex.offerSave && pickerAt !== i && !pageCreated && (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 flex items-center gap-3">
                      <p className="flex-1 font-body-sm text-body-sm text-on-background">
                        <strong className="font-semibold">Working on this?</strong> Save it as a wiki page that
                        collects new papers and trials daily.
                      </p>
                      <button
                        type="button"
                        onClick={() => setPickerAt(i)}
                        disabled={busy}
                        className="btn-primary shrink-0 px-4 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
                      >
                        Save page
                      </button>
                    </div>
                  )}
                  {!ex && pickerAt === i && !typing && (
                    <Picker onPick={(v) => send(CHOICE_INFO[v].label)} busy={busy} />
                  )}

                  {ex && ex.related.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">Related</span>
                      {ex.related.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => send(q)}
                          disabled={busy}
                          className="w-full flex items-center justify-between gap-3 text-left px-3.5 py-2.5 rounded-xl border border-outline-variant/30 bg-white font-body-sm text-body-sm text-on-background hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                        >
                          <span>{q}</span>
                          <span className="material-symbols-outlined text-[18px] shrink-0">arrow_forward</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {typing && (
              <p className="font-body-md text-body-md text-secondary animate-pulse" role="status">
                {progress[Math.min(progressStep, progress.length - 1)]}
              </p>
            )}

            {draft && !typing && (
              <CommunityDraft
                draft={draft}
                kind={siteAdmin ? draftKind : "team"}
                canChoose={siteAdmin === true}
                onKind={setDraftKind}
                stage={draftStage}
                signedIn={!!user}
                authLoading={authLoading}
                onChange={setDraft}
                onStage={setDraftStage}
                onCreate={() => void createCommunityNow()}
              />
            )}

            {action && phase.kind === "idle" && !typing && (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 flex flex-col gap-3">
                <p className="font-body-md text-body-md text-on-background">
                  Create {action.visibility} page &lsquo;{action.title}&rsquo;?
                </p>
                {shownTeam && (
                  <p className="font-body-sm text-body-sm text-secondary">
                    It will be added to your team {shownTeam.name}. {TEAM_VISIBLE_NOTE}
                    {action.visibility === "private" ? " Its visibility will change from private to team." : ""}
                  </p>
                )}
                {!authLoading && !user && (
                  <p className="font-body-sm text-body-sm text-secondary">You&apos;ll be asked to sign in first.</p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => createPage(action)}
                    disabled={authLoading}
                    className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={change}
                    className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            {phase.kind === "checking" && (
              <p className="font-body-sm text-body-sm text-secondary">Checking for an existing public page…</p>
            )}

            {phase.kind === "duplicate" && action && (
              <div className="rounded-xl border border-outline-variant/40 bg-white p-4 flex flex-col gap-3">
                <p className="font-body-md text-body-md text-on-background">
                  <strong className="font-semibold">A public page on this already exists</strong>
                  <span className="block text-secondary">&lsquo;{phase.title}&rsquo;. You can follow it instead.</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={`/pages/${phase.slug}`}
                    className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      // Same page, private: nothing public to duplicate. It still
                      // goes through the confirm card below.
                      const next = afterDuplicateChoice(action, "private");
                      skipDup.current = pageKey(next.action);
                      setAction(next.action);
                      setPhase({ kind: "idle" });
                    }}
                    className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Create private
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (phase.stage === "late") {
                        // Create was already confirmed before this check ran.
                        skipDup.current = pageKey(action);
                        void createPage(action, true);
                      } else {
                        // Found before the confirm card: go on to it.
                        skipDup.current = pageKey(action);
                        setPhase({ kind: "idle" });
                      }
                    }}
                    className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md"
                  >
                    Create anyway
                  </button>
                </div>
              </div>
            )}

            {phase.kind === "collecting" && (
              <p className="font-body-md text-body-md text-secondary animate-pulse" role="status">
                Collecting sources… about a minute.
              </p>
            )}

            {phase.kind === "done" && (
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 flex flex-col gap-3" role="status">
                <p className="font-body-md text-body-md text-on-background">
                  {shownTeam && teamAdded === true
                    ? `Your page is ready and added to ${shownTeam.name}.`
                    : shownTeam && teamAdded === false
                      ? `Your page is ready, but it could not be added to ${shownTeam.name}. Add it from Curate wiki pages on the team page.`
                      : "Your page is ready."}
                </p>
                {shownTeam && teamAdded === true && (
                  <a href={`/teams/${shownTeam.slug}`} className="font-label-md text-label-md text-primary hover:underline">
                    Back to {shownTeam.name}
                  </a>
                )}
                <a
                  href={`/pages/${phase.slug}${phase.visibility === "team" ? "#team" : ""}`}
                  className="btn-primary self-start px-5 py-2 rounded-lg font-label-md text-label-md"
                >
                  Open your page
                </a>
                {phase.visibility === "team" && (
                  <p className="font-body-sm text-body-sm text-secondary">
                    Invite your team from the Team panel on the page.
                  </p>
                )}
              </div>
            )}

            {phase.kind === "error" && action && (
              <div className="flex flex-col gap-2">
                <p className="font-body-sm text-body-sm text-error" role="alert">
                  {phase.message}
                </p>
                <button
                  type="button"
                  onClick={() => createPage(action, true)}
                  className="btn-outline self-start px-5 py-2 rounded-lg font-label-md text-label-md"
                >
                  Try again
                </button>
              </div>
            )}

            {error && (
              <p className="font-body-sm text-body-sm text-error" role="alert">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <div className="px-5 pt-3 pb-3 bg-white border-t border-outline-variant/30">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-end gap-2 rounded-2xl border border-outline-variant/40 bg-white pl-4 pr-2 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter makes a new line.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                maxLength={500}
                placeholder="Ask about a topic or your research"
                aria-label="Message"
                className="flex-1 min-w-0 resize-none bg-transparent border-0 outline-none focus:ring-0 py-1.5 font-body-md text-body-md placeholder:text-secondary/50 max-h-32"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || !input.trim()}
                className="w-10 h-10 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[20px]">arrow_upward</span>
              </button>
            </form>
            <p className="mt-2 text-center font-body-sm text-[11px] leading-snug text-secondary">
              Answers use only the sources shown. Check citations before relying on them.
            </p>
          </div>
            </>
          )}
        </aside>
      )}
    </>
  );
}
