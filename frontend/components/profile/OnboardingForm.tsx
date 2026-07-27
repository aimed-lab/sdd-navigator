"use client";

// Onboarding / profile setup form.
//
// Layout follows design/stitch/smartdrugdiscovery_profile_setup_flow: centred
// column of cards — Identity (ORCID import), Profile, Research Interests, then
// the optional "what you offer" strip — with Finish + "Skip for now" at the end.
// Nav/Footer come from the root layout per design/SHELL.md.
//
// NOT FORCED. Everything here is optional and "Skip for now" is always present:
// a researcher who just wants to read should never be trapped behind a form.
// The same component is what /settings reuses for the profile fields.
//
// AUTH: no Supabase. Saves go through app/profile/actions.ts → lib/server/*.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeOnboardingAction, loadProfileAction } from "@/app/profile/actions";
import { Banner, Card, ChipInput, Field, inputCls, labelCls } from "./FormUI";

type Work = { title: string; year: number | null; url: string | null };

// Mirrors the Stitch "Have something to share?" strip. These are LINKS, not
// stored state — what a lab offers is registered on Collaborate, which has the
// per-category fields for it. Capturing a bare category here would be a
// half-record with nowhere to live.
const OFFER_CATEGORIES = [
  { label: "Technique", icon: "science" },
  { label: "Equipment", icon: "biotech" },
  { label: "Animal Model", icon: "pets" },
  { label: "Cell Line", icon: "grid_view" },
  { label: "Vector", icon: "polyline" },
  { label: "Protein", icon: "microbiology" },
  { label: "Software", icon: "terminal" },
  { label: "Drug", icon: "medication" },
] as const;

export default function OnboardingForm() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [orcid, setOrcid] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [bio, setBio] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [scholar, setScholar] = useState("");
  const [github, setGithub] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [works, setWorks] = useState<Work[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from whatever already exists — onboarding is reachable later, and a
  // returning user must not see their own profile as blank.
  useEffect(() => {
    let cancelled = false;
    loadProfileAction().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        const p = res.profile;
        setName(p.name);
        setTitle(p.title);
        setAffiliation(p.affiliation);
        setBio(p.bio);
        setLinkedin(p.linkedin_url);
        setWebsite(p.website_url);
        setScholar(p.scholar_url);
        setGithub(p.github_url);
        setInterests(p.interests);
        if (p.orcid_url) {
          const m = p.orcid_url.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
          if (m) setOrcid(m[1]);
        }
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runImport() {
    if (!orcid.trim() || importing) return;
    setImporting(true);
    setImportError(null);

    try {
      const res = await fetch(`/api/orcid?id=${encodeURIComponent(orcid.trim())}`);
      const json = await res.json();

      if (!res.ok) {
        setImportError(json?.error ?? "Couldn't import from ORCID.");
        return;
      }

      // Import FILLS BLANKS, never overwrites something already typed — a
      // researcher who corrected their name shouldn't lose it to an import.
      const p = json.person ?? {};
      if (p.name && !name.trim()) setName(p.name);
      if (p.bio && !bio.trim()) setBio(p.bio);
      if (p.linkedin && !linkedin.trim()) setLinkedin(p.linkedin);
      if (Array.isArray(p.keywords) && p.keywords.length > 0) {
        setInterests((prev) => {
          const merged = [...prev];
          for (const k of p.keywords as string[]) {
            if (!merged.some((x) => x.toLowerCase() === k.toLowerCase()) && merged.length < 20) {
              merged.push(k);
            }
          }
          return merged;
        });
      }
      if (Array.isArray(json.works)) setWorks(json.works as Work[]);
      setImported(true);
    } catch {
      setImportError("Couldn't reach ORCID. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    setError(null);

    const form = new FormData();
    form.set("name", name);
    form.set("title", title);
    form.set("affiliation", affiliation);
    form.set("bio", bio);
    form.set("linkedin_url", linkedin);
    form.set("website_url", website);
    form.set("scholar_url", scholar);
    form.set("github_url", github);
    if (orcid.trim()) form.set("orcid_url", `https://orcid.org/${orcid.trim()}`);
    form.set("interests", JSON.stringify(interests));
    form.set("works", JSON.stringify(works));

    const result = await completeOnboardingAction(form);
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    router.push("/explore");
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-panel rounded-2xl p-8 animate-pulse">
            <div className="h-5 w-44 rounded bg-surface-container" />
            <div className="h-4 w-full rounded bg-surface-container mt-5" />
            <div className="h-4 w-4/6 rounded bg-surface-container mt-2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Identity / ORCID import ─────────────────────────────────────── */}
      <Card
        icon="fingerprint"
        title="Identity"
        subtitle="Paste your ORCID and we'll fill in the rest."
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={orcid}
            onChange={(e) => setOrcid(e.target.value)}
            placeholder="0000-0000-0000-0000"
            aria-label="ORCID iD"
            className={inputCls + " flex-1 font-mono"}
          />
          <button
            type="button"
            onClick={runImport}
            disabled={importing || !orcid.trim()}
            className="btn-primary shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {importing ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">sync</span>
                Import from ORCID
              </>
            )}
          </button>
        </div>

        {importError && <Banner kind="error">{importError}</Banner>}
        {imported && !importError && (
          <Banner kind="success">
            Imported from ORCID — review everything below before saving.
            {works.length > 0 && ` ${works.length} publication${works.length === 1 ? "" : "s"} found.`}
          </Banner>
        )}

        <p className="font-body-sm text-body-sm text-secondary">
          No ORCID? Just fill in the fields below — every one of them is optional.
        </p>
      </Card>

      {/* ── Profile ─────────────────────────────────────────────────────── */}
      <Card icon="badge" title="Profile" subtitle="How you appear to other researchers.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Full name" htmlFor="ob-name">
            <input
              id="ob-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr. Elena Rodriguez"
              className={inputCls}
            />
          </Field>
          <Field label="Role / title" htmlFor="ob-title">
            <input
              id="ob-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Principal Investigator"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Affiliation" htmlFor="ob-affiliation">
          <input
            id="ob-affiliation"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            placeholder="University of Alabama at Birmingham"
            className={inputCls}
          />
        </Field>

        <Field
          label="Bio"
          htmlFor="ob-bio"
          hint="A couple of sentences on what your lab works on."
        >
          <textarea
            id="ob-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            placeholder="Specializing in nutrient-sensing pathways and cancer cell metabolism…"
            className={inputCls + " resize-y"}
          />
        </Field>

        <div>
          <span className={labelCls}>Online presence</span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { id: "ob-linkedin", icon: "link", ph: "LinkedIn URL", v: linkedin, set: setLinkedin },
              { id: "ob-website", icon: "language", ph: "Website URL", v: website, set: setWebsite },
              { id: "ob-scholar", icon: "school", ph: "Google Scholar URL", v: scholar, set: setScholar },
              { id: "ob-github", icon: "code", ph: "GitHub URL", v: github, set: setGithub },
            ].map((f) => (
              <div key={f.id} className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-secondary text-base">
                  {f.icon}
                </span>
                <input
                  id={f.id}
                  value={f.v}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder={f.ph}
                  aria-label={f.ph}
                  className={inputCls + " pl-11"}
                />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Research interests ──────────────────────────────────────────── */}
      <Card
        icon="science"
        title="Research interests"
        subtitle="We use these to personalise your feed. Edit them anytime."
      >
        <ChipInput
          values={interests}
          onChange={setInterests}
          ariaLabel="Add a research interest"
          placeholder="e.g. cancer metabolism — press Enter"
        />
      </Card>

      {/* ── Imported publications (only after an import found some) ─────── */}
      {works.length > 0 && (
        <Card
          icon="library_books"
          title="Publications from ORCID"
          subtitle={`The ${works.length} most recent — saved with your profile.`}
        >
          <ul className="space-y-3">
            {works.map((w, i) => (
              <li
                key={`${w.title}-${i}`}
                className="flex items-start justify-between gap-4 pb-3 border-b border-outline-variant/30 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="font-body-md text-body-md text-on-background">{w.title}</p>
                  {w.year && (
                    <p className="font-body-sm text-body-sm text-secondary mt-0.5">{w.year}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setWorks(works.filter((_, j) => j !== i))}
                  aria-label={`Remove ${w.title}`}
                  className="shrink-0 text-secondary hover:text-error transition-colors"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── What you offer (optional, links out) ────────────────────────── */}
      <Card
        icon="handshake"
        title="Have something to share?"
        subtitle="Tell the community what your lab can offer — others can find and collaborate with you."
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {OFFER_CATEGORIES.map((c) => (
            <Link
              key={c.label}
              href="/collaborate/new"
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-outline-variant/60 hover:border-primary hover:bg-surface-container-low transition-all text-center"
            >
              <span className="material-symbols-outlined text-secondary">{c.icon}</span>
              <span className="font-label-sm text-label-sm text-on-background">{c.label}</span>
            </Link>
          ))}
        </div>
        <p className="flex items-start gap-1.5 font-body-sm text-body-sm text-secondary">
          <span className="material-symbols-outlined text-base">info</span>
          These open the Collaborate form, where the details for each kind live.
          Nothing here is required to finish setup.
        </p>
      </Card>

      {error && <Banner kind="error">{error}</Banner>}

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-5 pt-2">
        <button
          type="button"
          onClick={finish}
          disabled={saving}
          className="btn-primary px-10 py-3.5 rounded-xl font-label-md text-label-md inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            "Finish setup"
          )}
        </button>
        <Link
          href="/explore"
          className="font-label-md text-label-md text-secondary hover:text-primary transition-colors"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}
