import { connection } from "next/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Globe2, Network, ShieldCheck } from "lucide-react";
import { getOrganizationContext } from "@/lib/organization-context";
import { StatusBadge } from "@/components/dashboard/dashboard-badges";
import { CompactSummary, PageHeader } from "@/components/dashboard/dashboard-primitives";
import { DomainDetailTabs } from "@/components/dashboard/domains/domain-detail-tabs";
import { loadDomains, type DomainMonitorStatus } from "../data";

function health(status: DomainMonitorStatus) {
  if (status === "online") return { label: "Healthy", tone: "success" as const };
  if (status === "offline") return { label: "Issue detected", tone: "danger" as const };
  return { label: "Not checked", tone: "neutral" as const };
}

export default async function DomainDetailsPage({ params }: { params: Promise<{ domain: string }> }) {
  await connection();
  const { user, organization } = await getOrganizationContext();
  if (!user) redirect("/auth/login");
  if (!organization) redirect("/onboarding");
  const { domain: encodedDomain } = await params;
  let hostname: string;
  try { hostname = decodeURIComponent(encodedDomain).toLowerCase(); } catch { notFound(); }
  const { domains } = await loadDomains(organization.id);
  const domain = domains.find((item) => item.hostname === hostname);
  if (!domain) notFound();
  const overallHealth = health(domain.status);
  return <div className="sg-page-shell"><div className="sg-page">
    <Link href="/dashboard/domains" className="mb-5 inline-flex items-center gap-2 text-sm text-surface-muted transition hover:text-white"><ArrowLeft size={16} />Back to Domains & DNS</Link>
    <PageHeader title={domain.hostname} eyebrow="Domain inventory" icon={<Globe2 size={22} />} badge={<StatusBadge status={overallHealth.label} tone={overallHealth.tone}>{overallHealth.label}</StatusBadge>} description="Health reflects the current result of linked HTTP and HTTPS monitors." />
    <CompactSummary label="Domain overview" items={[{ label: "Linked monitors", value: domain.endpoints.length, icon: <Globe2 size={14} /> }, { label: "Healthy monitors", value: domain.endpoints.filter((endpoint) => endpoint.status === "online").length, icon: <ShieldCheck size={14} />, tone: "success" }, { label: "SSL status", value: "Not checked", icon: <ShieldCheck size={14} /> }, { label: "DNS records", value: "Not available", icon: <Network size={14} /> }]} />
    <DomainDetailTabs endpoints={domain.endpoints} />
  </div></div>;
}
