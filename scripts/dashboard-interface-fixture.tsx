import InfrastructureSearch from "@/components/infrastructure-search";
import { Input } from "@/components/ui/input";
import DeviceTabs from "@/components/dashboard/devices/device-tabs";
import { RoleBadge, StatusBadge } from "@/components/dashboard/dashboard-badges";
import { CompactSummary } from "@/components/dashboard/dashboard-primitives";
import { useState } from "react";
import { AppearanceProvider } from "@/components/dashboard/appearance-provider";
import AppearanceSettings from "@/components/dashboard/appearance-settings";
import DashboardSidebar from "@/components/dashboard/dashboard-sidebar";
import OrganizationClients from "@/app/dashboard/organizations/[id]/organization-clients";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

export default function InterfaceFixture({ terminalInput }: { terminalInput: string }) {
  const [section, setSection] = useState("overview");
  const [filter, setFilter] = useState("all");
  return <AppearanceProvider>
    <div className="sg-dashboard relative flex h-dvh overflow-hidden">
      <DashboardSidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="sg-topbar flex h-[72px] shrink-0 items-center border-b border-surface-edge px-6">Workspace</header>
        <main id="dashboard-content" className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="dashboard-grid pointer-events-none absolute inset-0" />
          <div className="sg-page relative space-y-5">
            <h1 className="sg-page-title">Settings</h1>
            <div data-fixture="badges"><RoleBadge role="owner" /><RoleBadge role="admin" /><RoleBadge role="member" />{["active", "online", "offline", "warning", "connected"].map(status => <StatusBadge key={status} status={status} />)}</div>
            <CompactSummary label="Client device summary" items={[{ label: "Devices", value: 2, icon: null }, { label: "Online", value: 2, icon: null }, { label: "Offline", value: 0, icon: null }, { label: "Alerts", value: 0, icon: null }]} />
            <AppearanceSettings />
            <section className="sg-surface sg-panel-body" data-fixture="directory">
              <OrganizationClients organizationId="org-1" clients={[
                { id: "client-1", name: "Northstar Technologies", description: "Production infrastructure", status: "active" },
                { id: "client-2", name: "Very long client name that should truncate gracefully on a small viewport", description: "Archived workspace", status: "inactive" },
              ]} />
            </section>
            <section className="sg-surface sg-panel-body flex flex-wrap gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="sg-button sg-button-secondary" type="button" data-fixture="filter">Status filter</button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuRadioGroup value={filter} onValueChange={setFilter}>
                    <DropdownMenuRadioItem value="all">All signals</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="active">Active</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSub><DropdownMenuSubTrigger>More</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Nested option</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
              <label>Site <select className="sg-control" defaultValue="all"><option value="all">All sites</option><option>Headquarters</option></select></label>
              <DeviceTabs value={section} onChange={setSection} tabs={[{ id: "overview", label: "Overview" }, { id: "inventory", label: "Inventory" }, { id: "performance", label: "Performance" }]} />
            </section>
            <section className="sg-surface sg-panel-body space-y-4" data-fixture="focus-fields">
              <InfrastructureSearch />
              <Input aria-label="Shared input" />
              <textarea className="sg-control w-full" aria-label="Shared textarea" />
              <div data-fixture="terminal-field" dangerouslySetInnerHTML={{ __html: terminalInput }} />
            </section>
          </div>
        </main>
      </div>
    </div>
  </AppearanceProvider>;
}
