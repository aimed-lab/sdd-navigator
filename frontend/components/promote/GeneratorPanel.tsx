"use client";

// The Promote generator: paste a DOI / PMID / paper URL, get four LinkedIn post
// drafts, a funding pitch and a lay summary.
//
// NO LOGIN and NO AUTO-POSTING, deliberately. Every output is copy-to-clipboard;
// "Open LinkedIn" opens a compose window with nothing pre-filled by us and
// nothing sent. The researcher pastes and publishes themselves — the platform
// never posts on anyone's behalf.
//
// Error states are distinct on purpose:
//   404 -> "couldn't find that paper" (the user's input is wrong)
//   503 -> the friendly busy message (our upstream is rate-limited; retryable)
// Collapsing those into one message would tell a user to re-check a DOI that was
// perfectly fine.

import { useState } from "react";
import { TONE_LABEL, type GeneratorResult, type PromoTone } from "@/lib/showcaseTypes";

const EXAMPLES = ["10.1126/science.1225829", "22745249"];

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard can be blocked (insecure context / permissions). Fall back to
      // a hidden textarea so copy still works rather than silently doing nothing.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more we can do */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md"
    >
      <span className="material-symbols-outlined text-base">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? "Copied" : label}
    </button>
  );
}

/** Full post text as a researcher would paste it. */
function postText(v: GeneratorResult["variants"][number], sourceUrl: string) {
  return [v.hook, "", v.body, "", v.closingTag, sourceUrl, v.hashtags.join(" ")]
    .filter((l) => l !== undefined && l !== null)
    .join("\n")
    .trim();
}

function OutputBlock({
  title,
  icon,
  body,
  words,
}: {
  title: string;
  icon: string;
  body: string;
  words?: boolean;
}) {
  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <h3 className="flex items-center gap-2 font-headline-md text-lg text-on-background">
          <span className="material-symbols-outlined text-primary">{icon}</span>
          {title}
        </h3>
        <CopyButton text={body} />
      </div>
      {words && (
        <p className="font-label-sm text-label-sm text-secondary mb-2">
          {body.trim().split(/\s+/).length} words
        </p>
      )}
      <p className="font-body-md text-body-md text-on-background whitespace-pre-wrap">{body}</p>
    </div>
  );
}

export default function GeneratorPanel() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [cached, setCached] = useState(false);

  const run = async (value?: string) => {
    const q = (value ?? input).trim();
    if (!q || loading) return;
    if (value) setInput(value);

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/promote/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError({
          message: json?.error ?? "Something went wrong. Please try again.",
          retryable: Boolean(json?.retryable),
        });
      } else {
        setCached(res.headers.get("x-cache") === "HIT");
        setResult(json as GeneratorResult);
      }
    } catch {
      setError({ message: "Couldn't reach the generator. Please try again.", retryable: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="generator" className="scroll-mt-24">
      <div className="max-w-3xl">
        <h2 className="font-headline-lg text-headline-lg text-on-background">
          Turn a paper into posts
        </h2>
        <p className="mt-3 font-body-lg text-body-lg text-secondary">
          Paste a DOI, PubMed ID or paper link. You get four LinkedIn drafts, a
          funding paragraph and a plain-language summary — all grounded in the
          paper&apos;s own abstract. Nothing is posted for you.
        </p>
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="mt-8 flex flex-col sm:flex-row gap-3 max-w-3xl"
      >
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-secondary">
            link
          </span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="10.1126/science.1225829, a PubMed ID, or a paper URL"
            aria-label="DOI, PubMed ID or paper URL"
            className="w-full glass-panel rounded-xl pl-12 pr-4 py-4 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="btn-primary px-8 py-4 rounded-xl font-label-md text-label-md disabled:opacity-50 shrink-0"
        >
          {loading ? "Generating…" : "Generate"}
        </button>
      </form>

      {!result && !loading && (
        <p className="mt-3 font-body-sm text-body-sm text-secondary">
          Try{" "}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              {i > 0 && " or "}
              <button
                onClick={() => run(ex)}
                className="text-primary hover:underline underline-offset-4"
              >
                {ex}
              </button>
            </span>
          ))}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="mt-8 space-y-4" aria-live="polite">
          <p className="font-body-md text-body-md text-secondary">
            Fetching the paper and drafting posts…
          </p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-panel rounded-2xl p-6 animate-pulse">
              <div className="h-5 w-40 rounded bg-surface-container" />
              <div className="h-4 w-full rounded bg-surface-container mt-4" />
              <div className="h-4 w-5/6 rounded bg-surface-container mt-2" />
            </div>
          ))}
        </div>
      )}

      {/* Error — busy (503) reads differently from not-found (404) */}
      {error && !loading && (
        <div className="mt-8 glass-panel rounded-2xl p-8 text-center" role="alert">
          <span className="material-symbols-outlined text-4xl text-primary">
            {error.retryable ? "hourglass_top" : "search_off"}
          </span>
          <p className="mt-3 font-headline-md text-lg text-on-background">{error.message}</p>
          {error.retryable && (
            <button
              onClick={() => run()}
              className="btn-primary mt-5 px-6 py-3 rounded-lg font-label-md text-label-md"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="mt-10 space-y-6">
          {/* Resolved paper */}
          <div className="glass-panel rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-label-sm text-label-sm text-secondary uppercase mb-1">
                  Paper found
                </p>
                <h3 className="font-headline-md text-lg text-on-background">
                  {result.paper.title}
                </h3>
                <p className="mt-1 font-body-sm text-body-sm text-secondary">
                  {result.paper.authors.slice(0, 4).join(", ")}
                  {result.paper.authors.length > 4 && " et al."}
                  {result.paper.publishedDate && ` · ${result.paper.publishedDate}`}
                </p>
              </div>
              {cached && (
                <span className="shrink-0 px-3 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm">
                  cached
                </span>
              )}
            </div>
            <a
              href={result.paper.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-3 font-label-md text-label-md text-primary hover:underline underline-offset-4"
            >
              View the source
              <span className="material-symbols-outlined text-base">open_in_new</span>
            </a>
          </div>

          {/* LinkedIn variants */}
          <div>
            <h3 className="font-headline-md text-headline-md text-on-background mb-4">
              LinkedIn drafts
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {result.variants.map((v) => {
                const full = postText(v, result.paper.sourceUrl);
                return (
                  <div key={v.tone} className="glass-panel rounded-2xl p-6 flex flex-col">
                    <span className="self-start px-3 py-1 mb-3 rounded-full bg-primary/5 text-primary font-label-sm text-label-sm">
                      {TONE_LABEL[v.tone as PromoTone] ?? v.tone}
                    </span>
                    <p className="font-body-md text-body-md text-on-background font-semibold">
                      {v.hook}
                    </p>
                    <p className="mt-3 font-body-md text-body-md text-secondary whitespace-pre-wrap">
                      {v.body}
                    </p>
                    {v.hashtags.length > 0 && (
                      <p className="mt-3 font-body-sm text-body-sm text-primary">
                        {v.hashtags.join(" ")}
                      </p>
                    )}
                    <div className="mt-auto pt-5 flex flex-wrap items-center gap-3">
                      <CopyButton text={full} label="Copy post" />
                      <a
                        href="https://www.linkedin.com/feed/?shareActive=true"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg btn-outline font-label-md text-label-md"
                      >
                        <span className="material-symbols-outlined text-base">open_in_new</span>
                        Open LinkedIn
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 font-body-sm text-body-sm text-secondary">
              Copy a draft, then paste it into LinkedIn. Nothing is posted
              automatically.
            </p>
          </div>

          <OutputBlock
            title="Funding pitch"
            icon="request_quote"
            body={result.fundingPitch}
            words
          />
          <OutputBlock title="Lay summary" icon="translate" body={result.laySummary} words />
        </div>
      )}
    </section>
  );
}
