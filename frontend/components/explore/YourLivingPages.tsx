"use client";

// "Your wiki" on the Explore landing: up to two of the viewer's pages
// with what's new and who can see them, and a dashed card that opens the
// assistant to start a new one (the assistant's usual picker and confirm step
// follow). Hidden entirely for a signed-out visitor.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { START_LIVING_PAGE_MESSAGE, openAssistant } from "@/lib/server/assistant/assistantBridge";
import SectionHeading from "@/components/explore/SectionHeading";

type Row = { slug: string; title: string; visibility: "private" | "team" | "public"; newItems: number };

const VISIBILITY_LABEL = { private: "Private", team: "Team", public: "Public" } as const;

export default function YourLivingPages() {
  const { user, loading: authLoading } = useAuth();
  const [pages, setPages] = useState<Row[] | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pages/mine", { cache: "no-store" });
        const json = (await res.json()) as { pages?: Row[] };
        if (!cancelled) setPages(Array.isArray(json.pages) ? json.pages : []);
      } catch {
        if (!cancelled) setPages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  if (authLoading || !user) return null; // signed out: the section is not shown

  const shown = (pages ?? []).slice(0, 2);

  return (
    <section aria-label="Your wiki">
      <div className="flex items-end justify-between gap-3 mb-4">
        <SectionHeading title="Your wiki" className="" />
        <Link href="/pages" className="font-label-md text-label-md text-primary hover:underline underline-offset-4 shrink-0 pb-1">
          All wiki pages →
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {shown.map((p) => (
          <Link
            key={p.slug}
            href={`/pages/${p.slug}`}
            className="rounded-2xl bg-white border border-outline-variant/30 hover:border-primary p-5 flex flex-col gap-2 transition-colors"
          >
            <span className="font-label-sm text-label-sm text-secondary">{VISIBILITY_LABEL[p.visibility]}</span>
            <h3 className="font-title text-[20px] leading-tight font-medium text-on-background line-clamp-2">{p.title}</h3>
            <p className={"font-body-sm text-body-sm " + (p.newItems > 0 ? "text-primary" : "text-secondary")}>
              {p.newItems > 0 ? `${p.newItems} new this week` : "Nothing new this week"}
            </p>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => openAssistant({ text: START_LIVING_PAGE_MESSAGE, mode: "send" })}
          className="rounded-2xl border-2 border-dashed border-primary bg-surface-container-low hover:bg-surface-container-low p-5 flex flex-col items-center justify-center gap-1 text-primary transition-colors min-h-[7.5rem]"
        >
          <span className="material-symbols-outlined">add</span>
          <span className="font-label-lg text-label-lg">New wiki page</span>
        </button>
      </div>
    </section>
  );
}
