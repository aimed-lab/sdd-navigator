"use client";

// Account settings — /settings.
//
// Section list on the left, one panel at a time on the right (the prototype's
// structure: Profile / Interests / Public profile / Danger Zone). One purpose
// per section, each saving independently, so a failed save in one place never
// silently discards edits in another.
//
// AUTH: no Supabase here. Profile/interests/notifications go through
// app/profile/actions.ts; deletion goes through app/auth/actions.ts →
// lib/auth.ts deleteAccount(). See the migration box in lib/auth.ts — none of
// the cascade logic is in this file, on purpose.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  loadProfileAction,
  saveInterestsAction,
  saveProfileAction,
  setProfileVisibilityAction,
} from "@/app/profile/actions";
import { deleteAccountAction } from "@/app/auth/actions";
import { Banner, Card, ChipInput, Field, inputCls, labelCls, ToggleSwitch } from "./FormUI";

// No Notifications section: the platform doesn't send email digests, so a
// preference for them would be a control that does nothing. The users table
// still has notify_weekly / notify_daily columns — harmless, and there if
// digests are ever built — but nothing in the app reads or writes them.
type SectionKey = "profile" | "interests" | "visibility" | "danger";

const SECTIONS: { key: SectionKey; label: string; icon: string }[] = [
  { key: "profile", label: "Profile", icon: "person" },
  { key: "interests", label: "Interests", icon: "science" },
  { key: "visibility", label: "Public profile", icon: "visibility" },
  { key: "danger", label: "Danger zone", icon: "warning" },
];

export default function SettingsPanels({ email }: { email: string }) {
  const [section, setSection] = useState<SectionKey>("profile");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // profile
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [bio, setBio] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [scholar, setScholar] = useState("");
  const [github, setGithub] = useState("");
  const [orcidUrl, setOrcidUrl] = useState("");

  const [interests, setInterests] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [profileSlug, setProfileSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProfileAction().then((p) => {
      if (cancelled) return;
      if (p.ok) {
        setName(p.profile.name);
        setTitle(p.profile.title);
        setAffiliation(p.profile.affiliation);
        setBio(p.profile.bio);
        setLinkedin(p.profile.linkedin_url);
        setWebsite(p.profile.website_url);
        setScholar(p.profile.scholar_url);
        setGithub(p.profile.github_url);
        setOrcidUrl(p.profile.orcid_url);
        setInterests(p.profile.interests);
        setIsPublic(p.profile.is_public);
        setProfileSlug(p.profile.profile_slug);
      } else {
        setLoadError(p.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-8 animate-pulse" aria-busy="true">
        <div className="h-5 w-40 rounded bg-surface-container" />
        <div className="h-4 w-full rounded bg-surface-container mt-5" />
        <div className="h-4 w-2/3 rounded bg-surface-container mt-2" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[13rem_1fr] gap-8">
      {/* Section nav */}
      <nav aria-label="Settings sections" className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
        {SECTIONS.map((s) => {
          const active = section === s.key;
          const danger = s.key === "danger";
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              aria-current={active ? "page" : undefined}
              className={
                "flex items-center gap-2 px-4 py-2.5 rounded-lg font-label-md text-label-md whitespace-nowrap transition-all text-left " +
                (active
                  ? danger
                    ? "bg-error-container text-on-error-container"
                    : "bg-primary text-on-primary"
                  : danger
                    ? "text-error hover:bg-error-container/40"
                    : "text-secondary hover:bg-surface-container-low hover:text-primary")
              }
            >
              <span className="material-symbols-outlined text-base">{s.icon}</span>
              {s.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-6">
        {loadError && <Banner kind="error">{loadError}</Banner>}

        {section === "profile" && (
          <ProfilePanel
            email={email}
            state={{ name, title, affiliation, bio, linkedin, website, scholar, github, orcidUrl }}
            setters={{
              setName,
              setTitle,
              setAffiliation,
              setBio,
              setLinkedin,
              setWebsite,
              setScholar,
              setGithub,
              setOrcidUrl,
            }}
          />
        )}

        {section === "interests" && (
          <InterestsPanel interests={interests} setInterests={setInterests} />
        )}

        {section === "visibility" && (
          <VisibilityPanel
            isPublic={isPublic}
            setIsPublic={setIsPublic}
            profileSlug={profileSlug}
          />
        )}

        {section === "danger" && <DangerPanel email={email} />}
      </div>
    </div>
  );
}

// ── Profile ──────────────────────────────────────────────────────────────────

function ProfilePanel({
  email,
  state,
  setters,
}: {
  email: string;
  state: Record<string, string>;
  setters: Record<string, (v: string) => void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const form = new FormData();
    form.set("name", state.name);
    form.set("title", state.title);
    form.set("affiliation", state.affiliation);
    form.set("bio", state.bio);
    form.set("linkedin_url", state.linkedin);
    form.set("website_url", state.website);
    form.set("scholar_url", state.scholar);
    form.set("github_url", state.github);
    form.set("orcid_url", state.orcidUrl);

    const res = await saveProfileAction(form);
    if (!res.ok) setError(res.error);
    else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  return (
    <Card icon="person" title="Profile" subtitle="How you appear to other researchers.">
      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="success">Profile saved.</Banner>}

      <div>
        <span className={labelCls}>Email</span>
        <p className="font-body-md text-body-md text-secondary">{email}</p>
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          Changing your sign-in email isn&apos;t available yet.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field label="Full name" htmlFor="set-name">
          <input
            id="set-name"
            value={state.name}
            onChange={(e) => setters.setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Role / title" htmlFor="set-title">
          <input
            id="set-title"
            value={state.title}
            onChange={(e) => setters.setTitle(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Affiliation" htmlFor="set-affiliation">
        <input
          id="set-affiliation"
          value={state.affiliation}
          onChange={(e) => setters.setAffiliation(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="Bio" htmlFor="set-bio">
        <textarea
          id="set-bio"
          value={state.bio}
          onChange={(e) => setters.setBio(e.target.value)}
          rows={4}
          className={inputCls + " resize-y"}
        />
      </Field>

      <div>
        <span className={labelCls}>Links</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { id: "set-linkedin", icon: "link", ph: "LinkedIn URL", k: "linkedin", s: setters.setLinkedin },
            { id: "set-website", icon: "language", ph: "Website URL", k: "website", s: setters.setWebsite },
            { id: "set-scholar", icon: "school", ph: "Google Scholar URL", k: "scholar", s: setters.setScholar },
            { id: "set-github", icon: "code", ph: "GitHub URL", k: "github", s: setters.setGithub },
            { id: "set-orcid", icon: "fingerprint", ph: "ORCID URL", k: "orcidUrl", s: setters.setOrcidUrl },
          ].map((f) => (
            <div key={f.id} className="relative">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary text-base">
                {f.icon}
              </span>
              <input
                id={f.id}
                value={state[f.k]}
                onChange={(e) => f.s(e.target.value)}
                placeholder={f.ph}
                aria-label={f.ph}
                className={inputCls + " pl-11"}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 pt-1">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
        <Link
          href="/onboarding"
          className="font-label-md text-label-md text-secondary hover:text-primary transition-colors"
        >
          Import from ORCID
        </Link>
      </div>
    </Card>
  );
}

// ── Interests ────────────────────────────────────────────────────────────────

function InterestsPanel({
  interests,
  setInterests,
}: {
  interests: string[];
  setInterests: (next: string[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await saveInterestsAction(interests);
    if (!res.ok) setError(res.error);
    else {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  return (
    <Card
      icon="science"
      title="Research interests"
      subtitle="Used to personalise what you see across the platform."
    >
      {error && <Banner kind="error">{error}</Banner>}
      {saved && <Banner kind="success">Interests saved.</Banner>}

      <ChipInput
        values={interests}
        onChange={setInterests}
        ariaLabel="Add a research interest"
        placeholder="e.g. PHGDH — press Enter"
      />

      <button
        onClick={save}
        disabled={saving}
        className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save interests"}
      </button>
    </Card>
  );
}

// ── Public profile ───────────────────────────────────────────────────────────

function VisibilityPanel({
  isPublic,
  setIsPublic,
  profileSlug,
}: {
  isPublic: boolean;
  setIsPublic: (v: boolean) => void;
  profileSlug: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const prev = isPublic;
    setIsPublic(next); // optimistic
    const res = await setProfileVisibilityAction(next);
    if (!res.ok) {
      setIsPublic(prev); // roll back so the switch never lies about stored state
      setError(res.error);
    }
    setBusy(false);
  }

  return (
    <Card
      icon="visibility"
      title="Public profile"
      subtitle="Control whether other researchers can find and read your profile."
    >
      {error && <Banner kind="error">{error}</Banner>}

      <ToggleSwitch
        checked={isPublic}
        disabled={busy}
        onChange={toggle}
        label="Make my profile public"
        description="When on, your name, affiliation, bio, links and interests are readable by anyone. Your email is never shown."
      />

      {isPublic && profileSlug && (
        <p className="font-body-sm text-body-sm text-secondary">
          Your profile is live at{" "}
          <Link
            href={`/researchers/${profileSlug}`}
            className="text-primary hover:underline underline-offset-4"
          >
            /researchers/{profileSlug}
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

// ── Danger zone ──────────────────────────────────────────────────────────────

function DangerPanel({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  async function confirmDelete() {
    if (!matches || deleting) return;
    setDeleting(true);
    setError(null);

    const form = new FormData();
    form.set("confirmEmail", typed);
    const res = await deleteAccountAction(form);

    if (!res.ok) {
      setError(res.error);
      setDeleting(false);
      return;
    }
    // Full navigation: the account and its session are gone, so nothing in the
    // current client tree is still valid.
    window.location.assign("/");
  }

  return (
    <>
      <section className="rounded-2xl p-6 md:p-8 border border-error/30 bg-error-container/20">
        <h2 className="flex items-center gap-2 font-headline-md text-lg text-error">
          <span className="material-symbols-outlined">warning</span>
          Delete account
        </h2>
        <p className="mt-3 font-body-md text-body-md text-on-background">
          This permanently deletes your account and everything attached to it —
          your profile, comments, collaboration posts, showcase entries, saved
          items, lab resources and projects.
        </p>
        <p className="mt-2 font-body-md text-body-md text-on-background font-semibold">
          It cannot be undone.
        </p>
        <button
          onClick={() => {
            setTyped("");
            setError(null);
            setOpen(true);
          }}
          className="mt-6 px-6 py-3 rounded-lg bg-error text-on-error font-label-md text-label-md hover:opacity-90 transition-opacity"
        >
          Delete my account
        </button>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-7 shadow-xl">
            <h3 id="delete-title" className="font-headline-md text-lg text-error">
              Delete your account?
            </h3>
            <p className="mt-3 font-body-md text-body-md text-on-background">
              Everything listed will be removed immediately and permanently. To
              confirm, type your email address below.
            </p>
            <p className="mt-2 font-body-sm text-body-sm text-secondary break-all">{email}</p>

            {error && (
              <div className="mt-4">
                <Banner kind="error">{error}</Banner>
              </div>
            )}

            <input
              type="email"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type your email to confirm"
              aria-label="Type your email to confirm deletion"
              autoComplete="off"
              className={inputCls + " mt-5"}
            />

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={deleting}
                className="btn-outline px-5 py-2.5 rounded-lg font-label-md text-label-md"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={!matches || deleting}
                className="px-5 py-2.5 rounded-lg bg-error text-on-error font-label-md text-label-md disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
