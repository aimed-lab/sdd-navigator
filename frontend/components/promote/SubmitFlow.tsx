"use client";

// The unified Promote submit flow, one screen:
//   - A DOI/PubMed ID field at the top -> fetch + generate the article
//     (generateArticle.ts). Unchanged.
//   - Below it, a structured five-question form for every OTHER type
//     (talk/poster/award/tool/event/other) -> generate the article
//     (generateStructuredArticle.ts).
//
// WHY FIVE QUESTIONS, NOT A FREEFORM BOX: there used to be a plain manual
// form here (Type + headline/standfirst/body/authors, typed by hand) and,
// briefly, a GitHub-URL-to-generated-post path. Both are gone. The post
// that worked was hand-written, and what made it work was its SHAPE — a
// one-liner, a before/now contrast, specifics in the person's own words, a
// hedge tied to how early this is, an ask naming who should reply — not
// where its content came from. A GitHub URL is still useful (see
// GithubPrefill below), but only as an optional shortcut to ANSWERING the
// five questions, never as the thing generation happens from.
//
// Either route lands in the SAME shared editor afterwards (ArticleEditor.tsx
// — also what app/promote/[slug]/edit/page.tsx reopens later), so there's
// exactly one edit/media/publish UI regardless of how the draft started.
//
// NO ROW ON PAGE LOAD, LAZY DRAFT CREATION. A media row is keyed to a
// showcase_id, so there's no id to upload against before a draft exists —
// the row is created the moment MediaUploader first needs an id (a file is
// attached) OR generation succeeds, whichever comes first. Opening
// /promote/submit and leaving creates nothing.
//
// REUSE, DON'T ORPHAN. If a row already exists from an attached file and
// the person THEN generates (DOI or structured), that same row is updated
// in place instead of creating a second one.

import { useRef, useState } from "react";
import Link from "next/link";
import { createArticleDraftAction, updateArticleDraftAction } from "@/app/promote/actions";
import ArticleEditor, {
  type ArticleEditorPaperInfo,
} from "@/components/promote/ArticleEditor";
import MediaUploader from "@/components/promote/MediaUploader";
import {
  SHOWCASE_TYPE_LABEL,
  STRUCTURED_QUESTIONS,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

const EXAMPLES = ["10.1126/science.1225829", "22745249"];

// Every choice except "paper" — the DOI box above already owns that one.
const NON_PAPER_TYPES = (Object.keys(STRUCTURED_QUESTIONS) as (keyof typeof STRUCTURED_QUESTIONS)[]);

const fieldClass =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-3 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40";

type PaperInfo = {
  title: string;
  authors: string[];
  sourceUrl: string;
  doi: string | null;
  pmid: string | null;
  publishedDate: string | null;
  journal: string | null;
};

type Entry = { id: string; slug: string };

/** Pull up to five lines out of the FIRST fenced code block in a README, for
 *  the tool type's optional GitHub prefill — a rough guess at example
 *  commands, never treated as authoritative (the person still edits/replaces
 *  it before Generate; nothing here is sent to the article generator
 *  directly). A leading "$ " (a common README convention for "type this")
 *  is stripped since the specifics field is commands, not shell prompts. */
function extractReadmeCommands(readme: string | null): string[] {
  if (!readme) return [];
  const match = readme.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((l) => l.replace(/^\$\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

export default function SubmitFlow({
  communities = [],
}: {
  /** Communities the signed-in author is an active member of — threaded
   *  straight through to ArticleEditor's own picker (see that component's
   *  prop comment). The picker only ever appears once you're in
   *  ArticleEditor, not on this screen's own DOI/structured form, so
   *  nothing here needs it beyond passing it along. */
  communities?: { id: string; slug: string; name: string }[];
}) {
  // DOI path — unchanged.
  const [input, setInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<{ message: string; retryable: boolean } | null>(
    null
  );
  const [paper, setPaper] = useState<PaperInfo | null>(null);

  // Shared fields — a successful DOI generate() OR a successful structured
  // generate() overwrites these; nothing types into them directly anymore
  // (see the removed freeform manual form, noted in this file's header).
  const [type, setType] = useState<ShowcaseType>(NON_PAPER_TYPES[0]);
  const [headline, setHeadline] = useState("");
  const [standfirst, setStandfirst] = useState("");
  const [articleBody, setArticleBody] = useState("");
  const [linkedinPost, setLinkedinPost] = useState("");
  const [authors, setAuthors] = useState("");

  // Structured path — the five answers, plus the optional GitHub prefill
  // (tool type only).
  const [oneLiner, setOneLiner] = useState("");
  const [contrast, setContrast] = useState("");
  const [specificsText, setSpecificsText] = useState("");
  const [context, setContext] = useState("");
  const [audience, setAudience] = useState("");
  const [structFetching, setStructFetching] = useState(false);
  const [structError, setStructError] = useState<{ message: string; retryable: boolean } | null>(
    null
  );
  // Flips once structured generation succeeds — the structured path's
  // counterpart to `paper` being set on the DOI path; both are what the
  // hand-off condition below checks.
  const [structGenerated, setStructGenerated] = useState(false);

  const [githubUrl, setGithubUrl] = useState("");
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);

  const [entry, setEntry] = useState<Entry | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const questions = STRUCTURED_QUESTIONS[type as keyof typeof STRUCTURED_QUESTIONS];

  // Creates the draft row on first use, memoized against concurrent callers
  // (attaching a file and clicking Generate in quick succession must not
  // race into two rows). Blank except for a placeholder title (the current
  // Type's label, or the headline if generation has already run) — just
  // enough for a slug. Returns the existing id immediately once one
  // exists; never creates a second row.
  const creatingRef = useRef<Promise<Entry> | null>(null);
  const ensureDraft = async (): Promise<string> => {
    if (entry) return entry.id;
    if (creatingRef.current) return (await creatingRef.current).id;

    const p = (async (): Promise<Entry> => {
      const created = await createArticleDraftAction({
        type,
        title: headline.trim() || SHOWCASE_TYPE_LABEL[type],
        headline: "",
        standfirst: "",
        articleBody: "",
        linkedinPost: "",
        authors: "",
        doi: null,
        link: null,
        journal: null,
        communityId: null,
      });
      if (!created.ok) throw new Error(created.error);
      return { id: created.id, slug: created.slug };
    })();

    creatingRef.current = p;
    try {
      const e = await p;
      setEntry(e);
      return e.id;
    } finally {
      creatingRef.current = null;
    }
  };

  const generate = async (value?: string) => {
    const q = (value ?? input).trim();
    if (!q || fetching) return;
    if (value) setInput(value);

    setFetching(true);
    setFetchError(null);

    try {
      const res = await fetch("/api/promote/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      const json = await res.json();

      if (!res.ok) {
        setFetchError({
          message: json?.error ?? "Something went wrong. Please try again.",
          retryable: Boolean(json?.retryable),
        });
        return;
      }

      const paperInfo: PaperInfo = json.paper;
      const authorsStr = paperInfo.authors.join(", ");
      setPaper(paperInfo);
      setHeadline(json.headline);
      setStandfirst(json.standfirst);
      setArticleBody(json.articleBody);
      setLinkedinPost(json.linkedinPost);
      setAuthors(authorsStr);
      setType("paper");

      if (entry) {
        // A row already exists (from an earlier attached file) — update it
        // in place rather than creating a second, orphaned one.
        const updated = await updateArticleDraftAction(entry.id, {
          type: "paper",
          headline: json.headline,
          standfirst: json.standfirst,
          articleBody: json.articleBody,
          linkedinPost: json.linkedinPost,
          authors: authorsStr,
          doi: paperInfo.doi,
          link: paperInfo.sourceUrl,
          journal: paperInfo.journal,
        });
        if (!updated.ok) setSaveError(updated.error);
      } else {
        const created = await createArticleDraftAction({
          type: "paper",
          title: paperInfo.title,
          headline: json.headline,
          standfirst: json.standfirst,
          articleBody: json.articleBody,
          linkedinPost: json.linkedinPost,
          authors: authorsStr,
          doi: paperInfo.doi,
          link: paperInfo.sourceUrl,
          journal: paperInfo.journal,
          communityId: null,
        });
        if (created.ok) setEntry({ id: created.id, slug: created.slug });
        else setSaveError(created.error);
      }
    } catch {
      setFetchError({ message: "Couldn't reach the generator. Please try again.", retryable: true });
    } finally {
      setFetching(false);
    }
  };

  const generateStructured = async () => {
    if (structFetching) return;

    const specifics = specificsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!oneLiner.trim() || !contrast.trim() || specifics.length < 3 || !context.trim() || !audience.trim()) {
      setStructError({
        message: "Answer all five questions (at least three specifics) to generate a post.",
        retryable: false,
      });
      return;
    }

    setStructFetching(true);
    setStructError(null);

    try {
      const res = await fetch("/api/promote/generate-structured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, oneLiner, contrast, specifics, context, audience }),
      });
      const json = await res.json();

      if (!res.ok) {
        setStructError({
          message: json?.error ?? "Something went wrong. Please try again.",
          retryable: Boolean(json?.retryable),
        });
        return;
      }

      setHeadline(json.headline);
      setStandfirst(json.standfirst);
      setArticleBody(json.articleBody);
      setLinkedinPost(json.linkedinPost);
      setStructGenerated(true);

      const id = await ensureDraft();
      const updated = await updateArticleDraftAction(id, {
        type,
        headline: json.headline,
        standfirst: json.standfirst,
        articleBody: json.articleBody,
        linkedinPost: json.linkedinPost,
        authors,
      });
      if (!updated.ok) setSaveError(updated.error);
    } catch (e) {
      setStructError({
        message: e instanceof Error ? e.message : "Couldn't reach the generator. Please try again.",
        retryable: true,
      });
    } finally {
      setStructFetching(false);
    }
  };

  // Optional prefill — tool type only. Never overwrites something already
  // typed, and never generates anything by itself; it only suggests values
  // for a few of the five fields (see extractReadmeCommands's own comment).
  const prefillFromGithub = async () => {
    if (!githubUrl.trim() || prefillLoading) return;
    setPrefillLoading(true);
    setPrefillError(null);

    try {
      const res = await fetch("/api/promote/github-prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: githubUrl.trim() }),
      });
      const json = await res.json();

      if (!res.ok) {
        setPrefillError(json?.error ?? "Couldn't fetch that repository.");
        return;
      }

      if (!oneLiner.trim() && json.description) setOneLiner(json.description);

      const contextBits = [
        json.language ? `Written in ${json.language}.` : null,
        Array.isArray(json.topics) && json.topics.length ? `Topics: ${json.topics.join(", ")}.` : null,
      ]
        .filter(Boolean)
        .join(" ");
      if (!context.trim() && contextBits) setContext(contextBits);

      const commands = extractReadmeCommands(json.readme ?? null);
      if (!specificsText.trim() && commands.length) setSpecificsText(commands.join("\n"));
    } catch {
      setPrefillError("Couldn't reach the lookup service. Please try again.");
    } finally {
      setPrefillLoading(false);
    }
  };

  // ── Hand off to the shared editor ─────────────────────────────────────────
  if (entry && (paper || structGenerated)) {
    const paperInfo: ArticleEditorPaperInfo = paper
      ? {
          kind: "paper",
          title: paper.title,
          authors: paper.authors,
          sourceUrl: paper.sourceUrl,
          journal: paper.journal,
          publishedDate: paper.publishedDate,
        }
      : null;

    return (
      <ArticleEditor
        entry={{
          id: entry.id,
          slug: entry.slug,
          published: false,
          type,
          headline,
          standfirst,
          articleBody,
          linkedinPost,
          authors,
          communityId: null,
        }}
        media={[]}
        paper={paperInfo}
        communities={communities}
      />
    );
  }

  // ── One screen: DOI box, then the structured form ─────────────────────────
  return (
    <div className="max-w-2xl space-y-6">
      <section className="glass-panel rounded-2xl p-6 space-y-4">
        <h2 className="font-headline-md text-lg text-on-background">
          Sharing a paper? Paste a DOI or PubMed ID
        </h2>
        <p className="font-body-sm text-body-sm text-secondary">
          We fetch the paper and draft an article from it — a headline, a
          standfirst, and a few plain-prose sections. You edit everything
          before any of it is public.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            generate();
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="10.1126/science.1225829 or a PubMed ID"
            aria-label="DOI or PubMed ID"
            className={fieldClass + " flex-1"}
          />
          <button
            type="submit"
            disabled={fetching || !input.trim()}
            className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 shrink-0"
          >
            {fetching ? "Generating…" : "Generate"}
          </button>
        </form>

        {!fetching && !fetchError && (
          <p className="font-body-sm text-body-sm text-secondary">
            Try{" "}
            {EXAMPLES.map((ex, i) => (
              <span key={ex}>
                {i > 0 && " or "}
                <button
                  type="button"
                  onClick={() => generate(ex)}
                  className="text-primary hover:underline underline-offset-4"
                >
                  {ex}
                </button>
              </span>
            ))}
          </p>
        )}

        {fetching && (
          <div className="space-y-3" aria-live="polite">
            <p className="font-body-sm text-body-sm text-secondary">
              Fetching the paper and drafting the article…
            </p>
            <div className="h-4 w-2/3 rounded bg-surface-container animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-surface-container animate-pulse" />
          </div>
        )}

        {fetchError && (
          <div role="alert">
            <p className="font-body-md text-body-md text-on-background">{fetchError.message}</p>
            {fetchError.retryable && (
              <button
                type="button"
                onClick={() => generate()}
                className="btn-outline mt-3 px-5 py-2 rounded-lg font-label-md text-label-md"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-outline-variant/30" />
        <span className="font-label-sm text-label-sm text-secondary">
          or describe what you&apos;re sharing
        </span>
        <div className="h-px flex-1 bg-outline-variant/30" />
      </div>

      <section className="glass-panel rounded-2xl p-6 space-y-5">
        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            What are you sharing?
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ShowcaseType)}
            className={fieldClass}
          >
            {NON_PAPER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SHOWCASE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        {type === "tool" && (
          <div className="rounded-lg border border-outline-variant/30 p-3 space-y-2">
            <p className="font-label-sm text-label-sm text-secondary">
              Optional — have a GitHub repo? Paste the URL to suggest a few answers below.
              You still write and can edit everything before generating.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                aria-label="GitHub repository URL"
                className={fieldClass + " flex-1"}
              />
              <button
                type="button"
                onClick={prefillFromGithub}
                disabled={prefillLoading || !githubUrl.trim()}
                className="btn-outline px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50 shrink-0"
              >
                {prefillLoading ? "Fetching…" : "Suggest answers"}
              </button>
            </div>
            {prefillError && (
              <p className="font-body-sm text-body-sm text-error">{prefillError}</p>
            )}
          </div>
        )}

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-1">
            {questions.oneLiner.label}
          </label>
          <p className="font-body-sm text-body-sm text-secondary/70 mb-2">
            Example: {questions.oneLiner.example}
          </p>
          <input
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-1">
            {questions.contrast.label}
          </label>
          <p className="font-body-sm text-body-sm text-secondary/70 mb-2">
            Example: {questions.contrast.example}
          </p>
          <textarea
            rows={2}
            value={contrast}
            onChange={(e) => setContrast(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-1">
            {questions.specifics.label}
          </label>
          <p className="font-body-sm text-body-sm text-secondary/70 mb-2">
            One per line, three to five. Example: {questions.specifics.example}
          </p>
          <textarea
            rows={4}
            value={specificsText}
            onChange={(e) => setSpecificsText(e.target.value)}
            placeholder={"One per line…"}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-1">
            {questions.context.label}
          </label>
          <p className="font-body-sm text-body-sm text-secondary/70 mb-2">
            Example: {questions.context.example}
          </p>
          <textarea
            rows={2}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-1">
            {questions.audience.label}
          </label>
          <p className="font-body-sm text-body-sm text-secondary/70 mb-2">
            Example: {questions.audience.example}
          </p>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            Authors / presenters (optional)
          </label>
          <input
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
            placeholder="Names, comma separated"
            className={fieldClass}
          />
        </div>

        <MediaUploader ensureShowcaseId={ensureDraft} type={type} initialMedia={[]} />

        {saveError && (
          <p className="font-body-sm text-body-sm text-error" role="alert">
            {saveError}
          </p>
        )}

        {structError && (
          <div role="alert">
            <p className="font-body-md text-body-md text-on-background">{structError.message}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <Link href="/promote" className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
            Cancel
          </Link>
          <button
            type="button"
            onClick={generateStructured}
            disabled={structFetching}
            className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {structFetching ? "Generating…" : "Generate"}
          </button>
        </div>
      </section>
    </div>
  );
}
