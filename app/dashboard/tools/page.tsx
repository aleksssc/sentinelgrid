import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { getOrganizationContext } from "@/lib/organization-context";
import { PageHeader } from "@/components/dashboard/dashboard-primitives";
import ToolsWorkspace from "@/components/dashboard/tools/tools-workspace";

export default async function ToolsPage() {
  const { user, organization } = await getOrganizationContext();
  if (!user) redirect("/auth/login");
  if (!organization) redirect("/onboarding");

  return <div className="sg-page-shell"><div className="sg-page">
    <PageHeader title="Tools" eyebrow="Diagnostics" icon={<Wrench size={22} />} description="A focused workspace for fast network, web and IP diagnostics." />
    <ToolsWorkspace />
  </div></div>;
}
