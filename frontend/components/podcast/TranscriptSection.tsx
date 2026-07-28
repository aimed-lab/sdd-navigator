"use client";

// Collapsible transcript — split out as its own client component because it's
// the only genuinely interactive piece of the episode detail page (show/hide
// state). Everything else on the page is now server-rendered directly from
// Supabase (see app/explore/podcast/[slug]/page.tsx).

import { useState } from "react";

export default function TranscriptSection({ transcript }: { transcript: string }) {
  const [showTranscript, setShowTranscript] = useState(false);

  return (
    <section>
      <h2 className="font-headline-lg text-headline-lg text-on-background mb-6">
        Full Transcript
      </h2>
      <div className="glass-panel rounded-xl p-6">
        <button
          onClick={() => setShowTranscript((s) => !s)}
          aria-expanded={showTranscript}
          className="w-full flex items-center justify-between gap-4 font-label-md text-label-md text-primary"
        >
          <span>
            {showTranscript ? "Hide transcript" : "Show transcript"}
            <span className="text-secondary ml-2">
              ({transcript.length.toLocaleString()} characters)
            </span>
          </span>
          <span className="material-symbols-outlined">
            {showTranscript ? "expand_less" : "expand_more"}
          </span>
        </button>

        {showTranscript && (
          <div className="mt-5 pt-5 border-t border-outline-variant/30 max-h-[32rem] overflow-y-auto">
            {transcript.split(/\n{2,}/).map((para, i) => (
              <p
                key={i}
                className="font-body-md text-body-md text-secondary mb-4 whitespace-pre-wrap"
              >
                {para}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
