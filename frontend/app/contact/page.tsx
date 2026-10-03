// Contact — /contact. Static server page, linked from the shared Footer.
// [CONTACT EMAIL] is a placeholder to be replaced with the real address.

export const metadata = { title: "Contact — SmartDrugDiscovery" };

export default function ContactPage() {
  return (
    <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16 space-y-6">
      <h1 className="font-headline-lg text-headline-lg md:text-[40px] md:leading-tight text-on-background">
        Contact
      </h1>
      <p className="font-body-lg text-body-lg text-secondary">
        Questions, feedback or ideas? Email us at{" "}
        <a
          href="mailto:[CONTACT EMAIL]"
          className="text-primary hover:underline underline-offset-4"
        >
          [CONTACT EMAIL]
        </a>
        .
      </p>
    </div>
  );
}
