import "./dashboard-background.css";

import DashboardSidebar from "@/components/dashboard/dashboard-sidebar";
import DashboardBackground from "@/components/dashboard/dashboard-background";

import NotificationsBell from "@/components/dashboard/notifications/notifications-bell";
import { LogoutButton } from "@/components/logout-button";

import {
  Search,
  Command,
} from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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

            <button
              type="button"
              className="
                group

                flex h-9 w-full max-w-[360px]
                items-center gap-2.5

                rounded-xl

                border border-white/[0.07]

                bg-white/[0.035]

                px-3

                text-left

                transition-all duration-200

                hover:border-white/[0.12]
                hover:bg-white/[0.055]
              "
            >
              <Search
                size={15}
                className="
                  shrink-0
                  text-zinc-500

                  transition-colors

                  group-hover:text-zinc-300
                "
              />

              <span className="flex-1 text-sm text-zinc-500">
                Search infrastructure...
              </span>

              <div
                className="
                  flex items-center gap-1

                  rounded-md

                  border border-white/[0.07]
                  bg-white/[0.04]

                  px-1.5 py-1

                  text-[10px]
                  text-zinc-500
                "
              >
                <Command size={10} />

                K
              </div>
            </button>

          </div>


          {/* =========================
              ACCOUNT
          ========================= */}

          <div className="flex items-center gap-2">

            <NotificationsBell />

            <div className="mx-1 h-5 w-px bg-white/[0.07]" />

            <LogoutButton />

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
  );
}