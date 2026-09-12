import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getOrganizationContext } from "@/lib/organization-context";
import { parseOperationsFilters, type SearchParams } from "@/lib/operations/filters";
import OperationsView from "@/components/dashboard/operations/operations-view";
import { loadAlerts } from "./data";

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const { user, organization } = await getOrganizationContext();
  if (!user) redirect("/auth/login");
  if (!organization) redirect("/onboarding");
  const filters = parseOperationsFilters(await searchParams, "alerts");
  const now = Date.now();
  const result = await loadAlerts(organization.id, user.id, filters, now);
  return <OperationsView kind="alerts" organizationName={organization.name} filters={filters} result={result} now={now} />;
}
