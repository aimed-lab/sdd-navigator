// Landing-page explainer for the Explore → Build → Promote flywheel.
// Static copy only (no live numbers). Each mode can be done solo, in a team, or
// in a community; communities run events where teams form.

import Link from "next/link";

const MODES = [
  {
    step: "01",
    name: "Explore",
    href: "/explore",
    body: "Collect and curate data from public sources: papers, datasets, trials, patents.",
    note: "Coming for paid members: proprietary assets.",
  },
  {
    step: "02",
    name: "Build",
    href: "/collaborate",
    body: "Turn collected assets into higher-value ones with workflows. AI agents work alongside scientists in a team to keep it compliant.",
    note: "Trust and value are created here, and kept.",
  },
  {
    step: "03",
    name: "Promote",
    href: "/promote",
    body: "Bring the new asset to the right people: researchers, users and patients who benefit from it.",
    note: "The right asset, to the right person.",
  },
];

const SCALES = [
  { name: "Individual", body: "Work on your own, at your own pace." },
  { name: "Team", body: "Formed by people you met at an event, online or in person, or brought together by a leader." },
  { name: "Community", body: "Events from communities such as CFDE, ATTIS and Bridge2AI." },
];

export default function FlywheelSection() {
  return (
    <section className="bg-[var(--explore-bg)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-14 md:py-16 border-t border-[#e7e4dc]">
        <div className="max-w-3xl mb-8">
          <h2 className="font-title text-[28px] md:text-[30px] leading-tight font-medium text-on-background">
            The Explore → Build → Promote flywheel
          </h2>
          <p className="mt-2 font-body-md text-body-md text-secondary">
            Each turn adds value. The wheel spins when the benefits outweigh the cost, and it speeds
            up when motivated users gain enough to pass it on, so the community grows by itself.
          </p>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          {MODES.map((m, i) => (
            <li key={m.name} className="tile relative flex flex-col gap-2 p-6 bg-white">
              <span className="type-label text-primary">{m.step}</span>
              <Link href={m.href} className="font-title text-[24px] font-medium text-on-background hover:text-primary">
                {m.name} →
              </Link>
              <p className="font-body-md text-body-md text-on-background/80">{m.body}</p>
              <p className="mt-auto pt-2 font-label-md text-label-md text-secondary">{m.note}</p>
              <span aria-hidden className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 text-primary text-xl">
                {i < MODES.length - 1 ? "→" : "↺"}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <p className="type-label text-secondary mb-3">Every step works at three scales</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            {SCALES.map((s) => (
              <div key={s.name} className="rounded-lg border border-[#e7e4dc] p-5">
                <p className="font-label-md text-label-md text-on-background">{s.name}</p>
                <p className="mt-1 font-body-md text-body-md text-secondary">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
