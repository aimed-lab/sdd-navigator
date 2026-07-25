"use client";

// Comments on an episode. Public read; posting is auth-gated — signed-out
// visitors see the thread plus a "log in to comment" prompt rather than a
// disabled box. Enforcement is RLS, not this component (see lib/comments.ts).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { listComments, postComment, type Comment } from "@/lib/comments";

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function CommentsSection({ wikiId }: { wikiId: string }) {
  const { user, displayName } = useAuth();
  const pathname = usePathname();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listComments(wikiId);
    setComments(rows);
    setLoading(false);
  }, [wikiId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || posting) return;
    setPosting(true);
    setError(null);

    const failure = await postComment(wikiId, user.id, draft);
    if (failure) {
      setError(failure);
    } else {
      setDraft("");
      await refresh();
    }
    setPosting(false);
  };

  return (
    <section className="mt-12">
      <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
        Discussion
        {!loading && comments.length > 0 && (
          <span className="ml-3 font-label-md text-label-md text-secondary align-middle">
            {comments.length}
          </span>
        )}
      </h2>

      {/* Composer / login prompt */}
      {user ? (
        <form onSubmit={submit} className="glass-panel rounded-xl p-5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder={`Add a comment as ${displayName ?? "yourself"}…`}
            aria-label="Add a comment"
            className="w-full bg-transparent resize-y font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none"
          />
          <div className="flex items-center justify-between gap-4 mt-3">
            <span className="font-body-sm text-body-sm text-error">{error}</span>
            <button
              type="submit"
              disabled={posting || !draft.trim()}
              className="btn-primary px-6 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {posting ? "Posting…" : "Post comment"}
            </button>
          </div>
        </form>
      ) : (
        <div className="glass-panel rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
          <p className="font-body-md text-body-md text-secondary">
            Join the discussion — sign in to leave a comment.
          </p>
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
            className="btn-primary px-6 py-2 rounded-lg font-label-md text-label-md"
          >
            Log in to comment
          </Link>
        </div>
      )}

      {/* Thread */}
      <div className="mt-6 space-y-4">
        {loading && (
          <>
            {[0, 1].map((i) => (
              <div key={i} className="glass-panel rounded-xl p-5 animate-pulse">
                <div className="h-4 w-32 rounded bg-surface-container" />
                <div className="h-4 w-full rounded bg-surface-container mt-3" />
              </div>
            ))}
          </>
        )}

        {!loading && comments.length === 0 && (
          <p className="font-body-md text-body-md text-secondary py-4">
            No comments yet — be the first to weigh in.
          </p>
        )}

        {!loading &&
          comments.map((c) => (
            <article key={c.id} className="glass-panel rounded-xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-9 h-9 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center font-label-sm text-label-sm">
                  {initials(c.author_name)}
                </span>
                <div className="min-w-0">
                  <p className="font-label-md text-label-md text-on-background truncate">
                    {c.author_name ?? "Member"}
                    {c.author_affiliation && (
                      <span className="text-secondary font-body-sm"> · {c.author_affiliation}</span>
                    )}
                  </p>
                  <p className="font-label-sm text-label-sm text-secondary">
                    {formatWhen(c.created_at)}
                  </p>
                </div>
              </div>
              <p className="font-body-md text-body-md text-on-background whitespace-pre-wrap">
                {c.content}
              </p>
            </article>
          ))}
      </div>
    </section>
  );
}
