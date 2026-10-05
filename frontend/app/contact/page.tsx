// Contact — /contact. Static server page, linked from the shared Footer.
// [CONTACT EMAIL] is a placeholder to be replaced with the real address.

import PageHeader, { PageShell } from "@/components/PageHeader";

export const metadata = { title: "Contact — SmartDrugDiscovery" };

export default function ContactPage() {
  return (
    <PageShell narrow className="space-y-6">
      <PageHeader title="Contact" className="mb-2" />
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
    </PageShell>
  );
}
