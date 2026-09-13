import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { dashboardLoader } from "./dashboard-test-loader.mjs";

const h = React.createElement;
const now = Date.now();
export const device = {
  id: "device-1", hostname: "SG-WKS-014", display_name: "Engineering workstation", status: "online",
  client_id: "client-1", site_id: "site-1", last_seen: new Date(now).toISOString(), os: "Windows", os_version: "11 Enterprise", os_build: "26100",
  arch: "amd64", device_type: "desktop", manufacturer: "Dell", model: "Precision 3680", serial_number: "SG-184026",
  cpu_name: "Intel Core i7", cpu_usage: 26, ram_usage: 42, disk_usage: 58, ram_total_bytes: 34359738368, ram_used_bytes: 14431090114,
  disk_total_bytes: 1099511627776, disk_used_bytes: 637716744110, uptime_seconds: 183200,
  local_ip: "192.0.2.14", public_ip: "198.51.100.12", mac_address: "00:11:22:33:44:55", agent_version: "0.1.9",
  capabilities: {}, last_inventory_at: new Date(now).toISOString(), sites: { id: "site-1", name: "Lisbon HQ" },
};
const data = {
  organizations: [{ id: "org-1", name: "Sentinel Operations", owner_id: "owner-1", description: "Infrastructure visibility and control, in one workspace." }],
  clients: [{ id: "client-1", organization_id: "org-1", name: "Northstar Technologies", status: "active", description: "Production infrastructure and employee endpoints." }],
  sites: [{ id: "site-1", client_id: "client-1", name: "Lisbon HQ" }],
  devices: [device, { ...device, id: "device-2", hostname: "SG-SRV-002", display_name: "Application server", device_type: "server", last_seen: new Date(now - 1200000).toISOString(), status: "offline" }],
  organization_members: [{ id: "member-1", organization_id: "org-1", user_id: "user-2", role: "admin", joined_at: "2026-08-12T12:00:00Z" }],
  organization_invites: [{ id: "invite-1", email: "new.member@example.test", role: "member", status: "pending", expires_at: "2026-09-30T12:00:00Z" }],
  monitors: [
    { id: "monitor-1", name: "Production API", url: "https://api.example.test/health", status: "online", status_code: 200, response_time_ms: 42, last_checked_at: new Date(now).toISOString() },
    { id: "monitor-2", name: "Customer portal", url: "https://portal.example.test", status: "offline", status_code: 503, response_time_ms: 1250, last_checked_at: new Date(now - 180000).toISOString() },
    { id: "monitor-3", name: "Status page", url: "https://status.example.test", status: "unknown", status_code: null, response_time_ms: null, last_checked_at: null },
  ],
};

export function fixtureMocks(overrides = {}) {
  const rows = { ...data, ...overrides };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1", email: "owner@example.test" } } }),
      admin: { getUserById: async (id) => ({ data: { user: { id, email: `${id}@example.test`, user_metadata: { full_name: id === "owner-1" ? "Alex Morgan" : "Jordan Taylor" } } }, error: null }) } },
    from(table) {
      let single = false;
      const builder = {
        select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, limit() { return this; }, or() { return this; },
        single() { single = true; return this; }, maybeSingle() { single = true; return this; }, abortSignal() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: single ? (rows[table]?.[0] ?? null) : (rows[table] ?? []), error: null, count: rows[table]?.length ?? 0 }).then(resolve, reject); },
      };
      return builder;
    },
  };
  return {
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/supabase/client": { createClient: () => db },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/audit/create-audit-log": { createAuditLog: async () => { throw new Error("Fixture cannot mutate data"); } },
    "next/server": { connection: async () => {} },
    "next/cache": { revalidatePath() { throw new Error("Fixture cannot mutate data"); } },
    "next/navigation": { useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/dashboard", notFound() { throw new Error("Fixture not found"); }, redirect(url) { throw new Error(`Fixture redirect: ${url}`); } },
    "next/link": ({ children, href, ...props }) => { delete props.prefetch; return h("a", { ...props, href }, children); },
    "next/image": (props) => { const attributes = { ...props }; delete attributes.preload; delete attributes.unoptimized; return h("img", attributes); },
    "./device-actions": { deleteDeviceAction: async () => { throw new Error("Fixture cannot delete devices"); } },
    "@/components/dashboard/devices/device-terminal": () => null,
  };
}

export async function renderDashboardFixtures() {
  const mocks = fixtureMocks();
  const load = dashboardLoader(mocks);
  const fixtures = {};
  for (const [name, file] of [
    ["dashboard", "app\\dashboard\\page.tsx"],
    ["organization", "app\\dashboard\\organizations\\[id]\\page.tsx"],
    ["clients", "app\\dashboard\\organizations\\[id]\\clients\\[clientId]\\page.tsx"],
    ["monitors", "app\\dashboard\\monitors\\page.tsx"],
    ["settings", "app\\dashboard\\organizations\\[id]\\settings\\page.tsx"],
    ["appearance", "app\\dashboard\\settings\\page.tsx"],
  ]) {
    fixtures[name] = renderToStaticMarkup(h(load("components\\dashboard\\appearance-provider.tsx").AppearanceProvider, null, await load(file).default({ params: Promise.resolve({ id: "org-1", clientId: "client-1" }), searchParams: Promise.resolve({}) })));
  }
  const emptyLoad = dashboardLoader(fixtureMocks({ monitors: [] }));
  fixtures["monitors-empty"] = renderToStaticMarkup(await emptyLoad("app\\dashboard\\monitors\\page.tsx").default());
  fixtures.loading = renderToStaticMarkup(h(load("components\\dashboard\\dashboard-loading.tsx").default));

  for (const tab of ["overview", "inventory", "software", "services", "security", "activity"]) {
    let cursor = 0;
    const drawerLoad = dashboardLoader({ ...mocks, react: { ...React, useState(initial) {
      const index = cursor++;
      return React.useState(index === 1 ? device : index === 2 ? true : index === 3 ? tab : initial);
    } } });
    const Drawer = drawerLoad("app\\dashboard\\organizations\\[id]\\clients\\[clientId]\\device-dashboard.tsx").default;
    fixtures[`drawer-${tab}`] = renderToStaticMarkup(h(Drawer, { devices: [device], sites: data.sites, clientName: "Northstar Technologies", canManage: true, activityCommands: [], rdpConfigured: false }));
  }
  const { PerformanceChart } = load("components\\dashboard\\devices\\device-performance.tsx");
  const { Cpu, MemoryStick, HardDrive } = await import("lucide-react");
  const history = { range: "1h", from: now - 3600000, to: now, interval: 30000, samples: Array.from({ length: 121 }, (_, i) => ({ timestamp: now - 3600000 + i * 30000, cpu_usage: 22 + Math.sin(i * 0.2) * 13, ram_usage: 40 + Math.cos(i * 0.1) * 4, disk_usage: 58 })) };
  const charts = [["cpu_usage", "CPU usage", "#34d399", Cpu], ["ram_usage", "Memory usage", "#38bdf8", MemoryStick], ["disk_usage", "Disk space used", "#a78bfa", HardDrive]].map(([metric, label, color, icon]) => h(PerformanceChart, { key: metric, data: history, metric, label, color, icon }));
  fixtures.performance = renderToStaticMarkup(h("div", { className: "sg-page space-y-4" }, charts));
  return fixtures;
}
