import "./dashboard-background.css";
import OrganizationGate from "@/components/dashboard/organization-gate";
import DashboardSidebar from "@/components/dashboard/dashboard-sidebar";
import DashboardBackground from "@/components/dashboard/dashboard-background";
import InfrastructureSearch from "@/components/infrastructure-search";
import NotificationsBell from "@/components/dashboard/notifications/notifications-bell";
import { UserMenu } from "@/components/user-menu";

import {
  Search,
  Command,
} from "lucide-react";

export const instant = false;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrganizationGate>
    <div className="relative flex h-screen overflow-hidden bg-[#0a0a0c] text-white">

      {/* =========================
          ANIMATED BACKGROUND
      ========================= */}

      <DashboardBackground />


      {/* =========================
          SIDEBAR
      ========================= */}

      <DashboardSidebar />


      {/* =========================
          RIGHT SIDE
      ========================= */}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">

        {/* =========================
            TOPBAR
        ========================= */}

        <header
          className="
            relative z-30
            flex h-[72px] shrink-0 items-center

            border-b border-white/[0.07]

            bg-[#0d0d0f]/75

            px-6

            backdrop-blur-xl
          "
        >
          {/* =========================
              SEARCH
          ========================= */}

          <div className="flex flex-1 items-center">
            
            <InfrastructureSearch />

          </div>


          {/* =========================
              ACCOUNT
          ========================= */}

          <div className="flex items-center gap-2">

            <NotificationsBell />

            <div className="mx-1 h-5 w-px bg-white/[0.07]" />

            <UserMenu />

          </div>

        </header>


        {/* =========================
            PAGE CONTENT
        ========================= */}

        <main
          className="
            relative z-10

            min-h-0 flex-1

            overflow-y-auto
            overflow-x-hidden
          "
        >
          {children}
        </main>

      </div>

    </div>
    </OrganizationGate>
  );
}