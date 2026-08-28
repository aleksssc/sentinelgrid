import Link from "next/link";
import {
  LayoutDashboard,
  Activity,
  Server,
  Globe,
  TriangleAlert,
  Bell,
  Bot,
  Wrench,
  Settings,
} from "lucide-react";

import { LogoutButton } from "@/components/logout-button";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex">

      {/* SIDEBAR */}
      <aside className="relative w-64 border-r border-zinc-800 bg-zinc-950 p-4">

        <div className="px-3 py-4 mb-6">
          <Link href="/" className="text-xl font-bold">
            SentinelGrid
          </Link>
        </div>

        <nav className="space-y-1">

          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <LayoutDashboard size={18} />
            Dashboard
          </Link>

          <Link
            href="/dashboard/monitors"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <Activity size={18} />
            Monitors
          </Link>

          <Link
            href="/dashboard/organizations"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <Server size={18} />
            Organizations
          </Link>

          <Link
            href="/dashboard/domains"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <Globe size={18} />
            Domains & DNS
          </Link>

          <Link
            href="/dashboard/incidents"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <TriangleAlert size={18} />
            Incidents
          </Link>

          <Link
            href="/dashboard/alerts"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <Bell size={18} />
            Alerts
          </Link>

          <Link
            href="/dashboard/agents"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <Bot size={18} />
            Agents
          </Link>

          <Link
            href="/dashboard/tools"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            <Wrench size={18} />
            Tools
          </Link>

        </nav>

        <div className="absolute bottom-5 left-4 right-4">
            <LogoutButton />
        </div>

      </aside>

      {/* CONTENT */}
      <div className="flex-1">
        {children}
      </div>

    </div>
  );
}