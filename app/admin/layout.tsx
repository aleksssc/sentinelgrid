import "../dashboard/dashboard-background.css";
import "../dashboard/dashboard-design.css";
import "../dashboard/dashboard-themes.css";
import "../dashboard/dashboard-interface.css";
import "../dashboard/information-style.css";
import "../dashboard/information-style-overrides.css";
import "./admin.css";
import "./admin-filter-bar.css";
import Link from "next/link";
import { ArrowLeft, Building2, ClipboardList, Gauge, RadioTower, Shield, Users } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/platform-access";

const navigation = [
  ["Overview", "/admin", Gauge], ["Organizations", "/admin/organizations", Building2], ["Users", "/admin/users", Users],
  ["Agent Releases", "/admin/agent-releases", RadioTower], ["System Health", "/admin/system", Shield], ["Audit", "/admin/audit", ClipboardList],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await requirePlatformAdmin();
  const roleLabel = role === "developer" ? "Developer" : "Platform Admin";

  return <div className="sg-dashboard sg-admin min-h-dvh bg-[#0a0a0c] text-white">
    <div className="sg-admin-layout min-h-dvh">
      <aside className="sg-admin-sidebar" aria-label="Platform administration">
        <Link href="/admin" className="sg-admin-brand" aria-label="SentinelGrid Admin overview">
          <span className="sg-admin-brand-mark"><Shield size={18} /></span>
          <span><strong>SentinelGrid</strong><small>Platform Admin</small></span>
        </Link>
        <div className="sg-admin-role"><span className="sg-badge-dot" aria-hidden="true" />{roleLabel}</div>
        <p className="sg-admin-nav-label">Administration</p>
        <nav className="sg-admin-navigation">
          {navigation.map(([label, href, Icon]) => <Link key={href} href={href} className="sg-admin-nav-link"><Icon size={16} />{label}</Link>)}
        </nav>
        <div className="sg-admin-sidebar-footer"><Link href="/dashboard" className="sg-admin-back"><ArrowLeft size={15} />Back to SentinelGrid</Link></div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sg-admin-topbar"><p>Platform administration</p><Link href="/dashboard" className="sg-admin-topbar-back"><ArrowLeft size={14} />Workspace</Link></header>
        <div className="sg-page-shell"><div className="sg-page">{children}</div></div>
      </main>
    </div>
  </div>;
}
