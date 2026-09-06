"use client";

// The unified Promote submit flow, one screen:
//   - A DOI/PubMed ID field at the top -> fetch + generate the article
//     (generateArticle.ts).
//   - Below it, the manual form: a Type dropdown (paper/talk/poster/
//     award/tool/other — just a label on the entry, not a branch in this
//     flow), headline, standfirst, body, authors, and the Media uploader.
// Either route lands in the SAME shared editor afterwards (ArticleEditor.tsx
// — also what app/promote/[slug]/edit/page.tsx reopens later), so there's
// exactly one edit/media/publish UI regardless of how the draft started.
//
// There used to be a category-picker screen ahead of this ("what are you
// showcasing?", six cards). Removed: five of the six categories led to the
// identical manual form, so the picker was a detour to a label that belongs
// in a dropdown. The only real branch was ever DOI-generated vs. hand-written.
//
// NO ROW ON PAGE LOAD. A media row is keyed to a showcase_id, so there's no
// id to upload against before a draft exists — but with a plain dropdown
// (no picker step to hang creation off of), the row is created lazily,
// on-demand, the moment the person first types into headline/standfirst/
// body/authors OR attaches a file, whichever comes first (see ensureDraft
// and its use in MediaUploader's `ensureShowcaseId` and the field
// onChanges below). Opening /promote/submit and leaving creates nothing.
//
// REUSE, DON'T ORPHAN. If a row already exists from typing/attaching a file
// and the person THEN uses the DOI box, generate() updates that same row
// instead of creating a second one — a second row would leave any
// already-attached media pointing at an abandoned draft nobody sees again.

import { useRef, useState } from "react";
import Link from "next/link";
import { createArticleDraftAction, updateArticleDraftAction } from "@/app/promote/actions";
import ArticleEditor, {
  type ArticleEditorPaperInfo,
} from "@/components/promote/ArticleEditor";
import MediaUploader from "@/components/promote/MediaUploader";
import { SHOWCASE_TYPES, SHOWCASE_TYPE_LABEL, type ShowcaseType } from "@/lib/showcaseTypes";

const EXAMPLES = ["10.1126/science.1225829", "22745249"];

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

export default function SubmitFlow() {
  // DOI path
  const [input, setInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<{ message: string; retryable: boolean } | null>(
    null
  );
  const [paper, setPaper] = useState<PaperInfo | null>(null);

  // Shared fields — manual typing populates these directly; a successful
  // DOI generate() overwrites them with the generated draft.
  const [type, setType] = useState<ShowcaseType>(SHOWCASE_TYPES[0]);
  const [headline, setHeadline] = useState("");
  const [standfirst, setStandfirst] = useState("");
  const [articleBody, setArticleBody] = useState("");
  const [authors, setAuthors] = useState("");

  const [entry, setEntry] = useState<Entry | null>(null);
  // Flips once the manual form's Continue succeeds — that's what hands the
  // manual path off to ArticleEditor. The DOI path never sets this; it goes
  // straight to ArticleEditor as soon as generate() has created/updated
  // `entry` (see the render condition below).
  const [manualContinued, setManualContinued] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Creates the draft row on first use, memoized against concurrent callers
  // (a fast typist and a simultaneous file pick must not race into two
  // rows). Blank except for a placeholder title (the current Type's label,
  // or the headline if one's already been typed) — just enough for a slug.
  // Returns the existing id immediately once one exists; never creates a
  // second row.
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
        authors: "",
        doi: null,
        link: null,
        journal: null,
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

  // Fire-and-forget trigger for the manual form's text fields: start the
  // draft on first keystroke, but don't make every keystroke await it — the
  // field itself doesn't need the id, only Continue and the Media uploader
  // do, and both call ensureDraft themselves when they actually need it.
  const triggerDraft = () => {
    if (!entry) ensureDraft().catch((e) => setSaveError(e.message));
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
      setAuthors(authorsStr);
      setType("paper");

      if (entry) {
        // A row already exists (lazily created from earlier typing or an
        // attached file) — update it in place rather than creating a
        // second, orphaned one.
        const updated = await updateArticleDraftAction(entry.id, {
          type: "paper",
          headline: json.headline,
          standfirst: json.standfirst,
          articleBody: json.articleBody,
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
          authors: authorsStr,
          doi: paperInfo.doi,
          link: paperInfo.sourceUrl,
          journal: paperInfo.journal,
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

  // Persists the typed fields against whatever row ensureDraft resolves to
  // (almost always already resolved by now, from typing — this is a
  // fallback, not the normal path) and hands off to ArticleEditor.
  const continueManual = async () => {
    if (!headline.trim() || !articleBody.trim() || saving) return;
    setSaving(true);
    setSaveError(null);

    try {
      const id = await ensureDraft();
      const res = await updateArticleDraftAction(id, {
        type,
        headline: headline.trim(),
        standfirst,
        articleBody,
        authors,
      });
      if (res.ok) setManualContinued(true);
      else setSaveError(res.error);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save your draft. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Hand off to the shared editor ─────────────────────────────────────────
  if (entry && (paper || manualContinued)) {
    const paperInfo: ArticleEditorPaperInfo = paper
      ? {
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
          authors,
        }}
        media={[]}
        paper={paperInfo}
      />
    );
  }

  // ── One screen: DOI box, then the manual form ─────────────────────────────
  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-2xl p-6 space-y-4">
        <h2 className="font-headline-md text-lg text-on-background">
          Paste a DOI or PubMed ID
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
        <span className="font-label-sm text-label-sm text-secondary">or write it yourself</span>
        <div className="h-px flex-1 bg-outline-variant/30" />
      </div>

      <section className="glass-panel rounded-2xl p-6 space-y-5">
        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ShowcaseType)}
            className={fieldClass}
          >
            {SHOWCASE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SHOWCASE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            Headline
          </label>
          <input
            value={headline}
            onChange={(e) => {
              setHeadline(e.target.value);
              triggerDraft();
            }}
            placeholder="A clear, specific headline"
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            Standfirst
          </label>
          <textarea
            rows={2}
            value={standfirst}
            onChange={(e) => {
              setStandfirst(e.target.value);
              triggerDraft();
            }}
            placeholder="One or two sentences under the headline"
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            Body
          </label>
          <textarea
            rows={10}
            value={articleBody}
            onChange={(e) => {
              setArticleBody(e.target.value);
              triggerDraft();
            }}
            placeholder="What happened, why it matters, what comes next."
            className={fieldClass}
          />
        </div>

        <div>
          <label className="block font-label-md text-label-md text-on-background mb-2">
            Authors
          </label>
          <input
            value={authors}
            onChange={(e) => {
              setAuthors(e.target.value);
              triggerDraft();
            }}
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

        <div className="flex items-center justify-end gap-3">
          <Link href="/promote" className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
            Cancel
          </Link>
          <button
            type="button"
            onClick={continueManual}
            disabled={saving || !headline.trim() || !articleBody.trim()}
            className="btn-primary px-8 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
