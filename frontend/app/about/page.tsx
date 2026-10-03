// About — /about. Static server page, linked from the shared Footer.

export const metadata = { title: "About — SmartDrugDiscovery" };

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16 space-y-6">
      <h1 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
        About
      </h1>
      <p className="font-body-lg text-body-lg text-secondary">
        SmartDrugDiscovery is an open source drug discovery platform built at UAB SPARC (Systems
        Pharmacology AI Research Center). It brings the field&apos;s papers, data and tools into
        one searchable place.
      </p>
      <p className="font-body-lg text-body-lg text-secondary">
        Researchers explore papers, data and tools, collaborate on projects, and promote their
        work. The platform is nonprofit and pre-competitive.
      </p>
    </div>
  );
}
