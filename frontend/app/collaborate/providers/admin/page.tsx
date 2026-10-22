// Provider directory admin — /collaborate/providers/admin. Site admins only.
//
// Tabs (URL state, ?tab=): quote requests, page claims, "list your services"
// requests, and views / website clicks per provider for the last 30 days.
// Signed out gets a sign-in gate; a signed-in non-admin gets a 404. The data
// comes through the session client, so row-level security (public.is_site_admin())
// is the real gate; the check here only decides what to render.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader, { PageShell } from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/auth";
import { formatChicago, summarizeActivity } from "@/lib/server/providers/core";
import { getAllProviders, getProviderBySlug } from "@/lib/server/providers/providers";
import { loadAdminData } from "@/lib/server/providers/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Provider directory admin | SmartDrugDiscovery", robots: { index: false } };

const TABS = [
  { key: "quotes", label: "Quote requests" },
  { key: "claims", label: "Claims" },
  { key: "requests", label: "Provider requests" },
  { key: "activity", label: "Views and clicks" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function chip(active: boolean) {
  return (
    "px-5 py-2 rounded-full font-label-md text-label-md whitespace-nowrap transition-all " +
    (active
      ? "bg-primary text-on-primary"
      : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary")
  );
}

const when = formatChicago;
const nameOf = (slug: string) => getProviderBySlug(slug)?.name ?? slug;

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="mt-6 font-body-md text-body-md text-secondary">{empty}</p>;
  return (
    <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-[0_1px_2px_rgba(40,36,28,0.05)]">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-container-low text-secondary">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-label-md text-label-md whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-outline-variant/30 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 text-on-background max-w-[28rem] whitespace-pre-wrap break-words">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ProviderAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <PageShell narrow>
        <div className="glass-panel rounded-2xl p-10 text-center">
          <h1 className="font-headline-md text-headline-md text-on-background">Sign in</h1>
          <Link
            href="/login?callbackUrl=%2Fcollaborate%2Fproviders%2Fadmin"
            className="btn-primary inline-block mt-6 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            Sign in
          </Link>
        </div>
      </PageShell>
    );
  }
  const data = await loadAdminData(30);
  if (!data) notFound();

  const sp = await searchParams;
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "quotes";
  const counts: Record<TabKey, number> = {
    quotes: data.quotes.length,
    claims: data.claims.length,
    requests: data.requests.length,
    activity: data.events.length,
  };
  const activity = summarizeActivity(
    getAllProviders().map((p) => p.slug),
    data.events
  );

  return (
    <PageShell>
      <Link
        href="/collaborate/providers"
        className="inline-flex items-center gap-1 mb-6 font-label-md text-label-md text-secondary hover:text-primary"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Back to the directory
      </Link>
      <PageHeader title="Provider directory admin" subtitle="Requests from members and providers, and how much each page is used." />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/collaborate/providers/admin?tab=${t.key}`} className={chip(tab === t.key)}>
            {t.label}
            {t.key !== "activity" && ` (${counts[t.key]})`}
          </Link>
        ))}
      </div>

      {tab === "quotes" && (
        <Table
          head={["When", "Provider", "From", "Need", "Timeline", "Budget", "Message", "Status"]}
          empty="No quote requests yet."
          rows={data.quotes.map((q) => [
            when(q.created_at),
            nameOf(q.slug),
            `${q.name}\n${q.email}`,
            q.need,
            q.timeline,
            q.budget || "-",
            q.message || "-",
            q.status,
          ])}
        />
      )}
      {tab === "claims" && (
        <Table
          head={["When", "Provider", "Name", "Role", "Work email", "Note", "Status"]}
          empty="No claims yet."
          rows={data.claims.map((c) => [
            when(c.created_at),
            nameOf(c.slug),
            c.name,
            c.role,
            c.work_email,
            c.note || "-",
            c.status,
          ])}
        />
      )}
      {tab === "requests" && (
        <Table
          head={["When", "Company", "Website", "Contact", "Email", "What they offer", "Status"]}
          empty="No provider requests yet."
          rows={data.requests.map((r) => [
            when(r.created_at),
            r.company,
            r.website,
            r.contact_name,
            r.email,
            r.offer,
            r.status,
          ])}
        />
      )}
      {tab === "activity" && (
        <>
          <p className="mt-6 text-sm text-secondary/80">Last 30 days. A view is one page load; a click is one press of Visit website.</p>
          <Table
            head={["Provider", "Profile views", "Website clicks"]}
            empty="No activity yet."
            rows={activity.map((a) => [nameOf(a.slug), String(a.views), String(a.clicks)])}
          />
        </>
      )}
    </PageShell>
  );
}
