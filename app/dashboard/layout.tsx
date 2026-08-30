import Link from "next/link";
import Image from "next/image";

import NotificationsBell from "@/components/dashboard/notifications/notifications-bell";
import { LogoutButton } from "@/components/logout-button";

import {
  LayoutDashboard,
  Activity,
  Server,
  Globe,
  TriangleAlert,
  Bell,
  Bot,
  Wrench,
} from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-white">

      {/* =========================
          SIDEBAR
      ========================= */}

      <aside className="relative z-30 flex h-screen w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 shadow-[8px_0_24px_rgba(0,0,0,0.18)]">

        {/* =========================
            LOGO
        ========================= */}

        <div className="shrink-0 px-7 py-7">

          <Link
            href="/"
            className="flex items-center gap-2 font-bold"
          >
            <Image
              src="/logos/sentinelgrid_png.png"
              alt="SentinelGrid"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />

            <span className="text-lg">
              SentinelGrid
            </span>
          </Link>

        </div>


        {/* =========================
            NAVIGATION
        ========================= */}

        <nav className="flex-1 space-y-1 overflow-y-auto px-4">

          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <LayoutDashboard size={18} />
            Dashboard
          </Link>


          <Link
            href="/dashboard/monitors"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <Activity size={18} />
            Monitors
          </Link>


          <Link
            href="/dashboard/organizations"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <Server size={18} />
            Organizations
          </Link>


          <Link
            href="/dashboard/domains"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <Globe size={18} />
            Domains & DNS
          </Link>


          <Link
            href="/dashboard/incidents"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <TriangleAlert size={18} />
            Incidents
          </Link>


          <Link
            href="/dashboard/alerts"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <Bell size={18} />
            Alerts
          </Link>


          <Link
            href="/dashboard/agents"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <Bot size={18} />
            Agents
          </Link>


          <Link
            href="/dashboard/tools"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
          >
            <Wrench size={18} />
            Tools
          </Link>

        </nav>

      </aside>


      {/* =========================
          RIGHT SIDE
      ========================= */}

      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">


        {/* =========================
            TOPBAR
        ========================= */}

        <header className="relative z-20 flex h-16 shrink-0 items-center justify-end border-b border-zinc-800 bg-zinc-950/95 px-6 shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur-xl">

          <div className="flex items-center gap-3">

            {/* NOTIFICATIONS */}

            <NotificationsBell />


            {/* USER / ACCOUNT MENU */}

            <LogoutButton />

          </div>

        </header>


        {/* =========================
            PAGE CONTENT
        ========================= */}

        <main className="relative z-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">

          {children}

        </main>

      </div>

    </div>
  );
}