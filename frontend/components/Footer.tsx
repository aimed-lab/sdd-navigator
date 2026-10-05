// Shared shell footer — per design/SHELL.md: wordmark + tagline, and an
// understated row of links (About · Explore · Collaborate · Promote · Contact).

import Link from "next/link";

const LINKS = [
  { label: "About", href: "/about" },
  { label: "Explore", href: "/explore" },
  { label: "Collaborate", href: "/collaborate" },
  { label: "Promote", href: "/promote" },
  { label: "Contact", href: "/contact" },
] as const;

export default function Footer() {
  return (
    <footer className="bg-[#fbfaf7] border-t border-[#e7e4dc]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="space-y-1">
          <span className="font-title text-[24px] leading-8 font-medium text-on-background">
            SmartDrugDiscovery
          </span>
          <p className="font-label-md text-label-md text-secondary max-w-sm">
            Precision in research — explore, collaborate, and promote across drug discovery.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-label-md text-label-md text-secondary hover:text-primary transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
