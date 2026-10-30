"use client";

// What a signed-out visitor sees on an OPEN community: "Join with your email".
// One field, no password, no account. They become a member by email, and the
// membership is linked when they later sign in with the same address (see
// lib/server/communityJoin.ts). A request-to-join community never renders
// this: its signed-out visitors keep the "Sign in to request to join" link.

import Link from "next/link";
import { useState } from "react";
import { joinByEmailAction } from "@/app/communities/actions";

export default function EmailJoinForm({ slug, autoOpen }: { slug: string; autoOpen: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const signIn = `/login?callbackUrl=${encodeURIComponent(`/communities/${slug}`)}`;

  if (done) {
    return (
      <p role="status" className="rounded-lg bg-surface-container-low text-primary px-3 py-2.5 font-body-sm text-body-sm">
        {done}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md text-center"
        >
          Join
        </button>
        <Link href={signIn} className="font-label-sm text-label-sm text-secondary hover:text-primary text-center">
          Have an account? Sign in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const res = await joinByEmailAction(slug, email);
        setBusy(false);
        if (res.ok) setDone(res.message);
        else setError(res.error);
      }}
    >
      <label htmlFor="join-email" className="font-label-md text-label-md text-on-background">
        Join with your email
      </label>
      <input
        id="join-email"
        type="email"
        required
        autoFocus={autoOpen}
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@example.com"
        className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2.5 font-body-sm text-body-sm text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
      >
        {busy ? "Joining…" : "Join"}
      </button>
      <p className="font-body-sm text-body-sm text-secondary">No password, no account needed.</p>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <Link href={signIn} className="font-label-sm text-label-sm text-secondary hover:text-primary">
        Have an account? Sign in
      </Link>
    </form>
  );
}
