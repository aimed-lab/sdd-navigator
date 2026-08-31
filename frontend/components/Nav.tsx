"use client";

// Shared shell nav — STRUCTURE follows design/SHELL.md (wordmark left; Explore /
// Collaborate / Promote center with active highlight; right =
// Log in/Sign up OR account menu + Settings; hamburger on mobile). VISUAL style
// is taken from design/stitch/smartdrugdiscovery_landing_page/code.html.
// Per SHELL.md, the nav inside individual page HTML is ignored — this is the one.
//
// NO THEME TOGGLE: there used to be one here (a button flipping a `dark`
// class on <html>). Removed — the class was wired correctly, but there was
// no `dark:` style anywhere in the app for it to affect, so it was a
// control that visibly did nothing. `darkMode: "class"` is still set in
// tailwind.config.ts and nothing stops a future dark theme from using it;
// there just isn't one to toggle to yet.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const PILLARS = [
  { label: "Explore", href: "/explore" },
  { label: "Collaborate", href: "/collaborate" },
  { label: "Promote", href: "/promote" },
  { label: "Communities", href: "/communities" },
] as const;

// "Projects" goes FIRST, before Explore, but only once we know the viewer is
// signed in — a signed-out visitor has nothing to see at /projects (it
// redirects straight to /login), so the logged-out nav must not change at
// all. See callers below: both the desktop and mobile pillar lists build
// off this, never off PILLARS directly, so the two can't drift apart.
const PROJECTS_PILLAR = { label: "Projects", href: "/projects" } as const;

// Unseen count for the inbox badge. Refetched on every navigation so that
// opening /inbox (which marks things seen) is reflected when you leave it.
//
// Signed out we don't call at all and hold 0 — the badge simply isn't rendered,
// and there's no reason to ask the server about an inbox that can't exist.
function useUnseenInbox(signedIn: boolean, pathname: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inbox/count", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setCount(typeof json?.count === "number" ? json.count : 0);
      } catch {
        // A badge is not worth surfacing an error for; leave it at its last value.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, pathname]);

  return count;
}

export default function Nav() {
  const pathname = usePathname();
  const { user, displayName, signOut } = useAuth();
  const unseen = useUnseenInbox(!!user, pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Signed-out visitors see exactly the pillars they always have; Projects
  // only appears once `user` is known to be signed in.
  const pillars = user ? [PROJECTS_PILLAR, ...PILLARS] : PILLARS;

  return (
    <nav className="fixed top-0 left-0 w-full z-50 h-16 bg-white/70 backdrop-blur-xl border-b border-surface-variant/50 shadow-sm">
      <div className="max-w-container-max mx-auto h-full flex justify-between items-center px-margin-mobile md:px-margin-desktop">
        {/* Left: wordmark + center pillars */}
        <div className="flex items-center gap-8">
          <Link href="/" className="font-headline-md text-headline-md font-bold text-on-background">
            SmartDrugDiscovery
          </Link>
          <div className="hidden md:flex items-center gap-6">
            {pillars.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className={
                  isActive(p.href)
                    ? "font-body-md text-body-md text-primary font-bold border-b-2 border-primary pb-1"
                    : "font-body-md text-body-md text-secondary hover:text-primary transition-colors"
                }
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right: auth */}
        <div className="flex items-center gap-3">
          {/* Desktop auth actions — default to logged-out until we know otherwise
              (avoids a flicker and keeps the actions in the server-rendered HTML) */}
          <div className="hidden md:flex items-center gap-2">
            {/* One SSO button — no separate "Log in" vs "Sign up" anymore
                (see app/signup/page.tsx and app/login/page.tsx). */}
            {!user && (
              <Link href="/login" className="btn-primary px-6 py-2 rounded-lg font-label-md text-label-md">
                Sign in
              </Link>
            )}
            {user && (
              <Link
                href="/inbox"
                aria-label={unseen > 0 ? `Inbox, ${unseen} unread` : "Inbox"}
                className={
                  "relative p-2 rounded-full transition-all hover:bg-surface-container-low " +
                  (isActive("/inbox") ? "text-primary" : "text-secondary")
                }
              >
                {/* Bell reads as "something arrived" more immediately than the
                    inbox-tray icon did, especially with the unread badge on
                    it — route, label, and count are all unchanged. */}
                <span className="material-symbols-outlined">notifications</span>
                {unseen > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-on-primary font-label-sm text-[11px] leading-none">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
              </Link>
            )}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-container-low transition-all"
                >
                  <span className="material-symbols-outlined text-secondary">account_circle</span>
                  <span className="font-label-md text-label-md text-on-background">{displayName}</span>
                  <span className="material-symbols-outlined text-secondary text-base">expand_more</span>
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-44 rounded-lg border border-surface-variant/50 bg-surface-container-lowest shadow-lg py-1"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <Link
                      href="/settings"
                      className="flex items-center gap-2 px-4 py-2 font-label-md text-label-md text-on-background hover:bg-surface-container-low"
                      onClick={() => setMenuOpen(false)}
                    >
                      <span className="material-symbols-outlined text-secondary text-base">settings</span>
                      Settings
                    </Link>
                    <button
                      onClick={() => { setMenuOpen(false); signOut(); }}
                      className="w-full flex items-center gap-2 px-4 py-2 font-label-md text-label-md text-on-background hover:bg-surface-container-low text-left"
                    >
                      <span className="material-symbols-outlined text-secondary text-base">logout</span>
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Menu"
            className="md:hidden p-2 rounded-full hover:bg-surface-container-low transition-all"
          >
            <span className="material-symbols-outlined text-secondary">{mobileOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white/95 backdrop-blur-xl border-b border-surface-variant/50 px-margin-mobile py-4 flex flex-col gap-3">
          {pillars.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              onClick={() => setMobileOpen(false)}
              className={
                isActive(p.href)
                  ? "font-body-md text-body-md text-primary font-bold"
                  : "font-body-md text-body-md text-secondary"
              }
            >
              {p.label}
            </Link>
          ))}
          <div className="h-px bg-surface-variant/50 my-1" />
          {!user && (
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="btn-primary text-center px-6 py-2 rounded-lg font-label-md text-label-md"
            >
              Sign in
            </Link>
          )}
          {user && (
            <>
              <Link
                href="/inbox"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 font-label-md text-label-md text-on-background"
              >
                Inbox
                {unseen > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-on-primary text-[11px] leading-none">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
              </Link>
              <Link href="/settings" onClick={() => setMobileOpen(false)} className="font-label-md text-label-md text-on-background">
                Settings
              </Link>
              <button
                onClick={() => { setMobileOpen(false); signOut(); }}
                className="font-label-md text-label-md text-on-background text-left"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
