"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

import {
  LayoutDashboard,
  Activity,
  Building2,
  Globe2,
  TriangleAlert,
  Bell,
  Bot,
  Wrench,
  ChevronRight,
} from "lucide-react";

const navigation = [
  {
    name: "Overview",
    href: "/dashboard",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    name: "Monitors",
    href: "/dashboard/monitors",
    icon: Activity,
  },
  {
    name: "Organizations",
    href: "/dashboard/organizations",
    icon: Building2,
  },
  {
    name: "Domains & DNS",
    href: "/dashboard/domains",
    icon: Globe2,
  },
];

const operations = [
  {
    name: "Incidents",
    href: "/dashboard/incidents",
    icon: TriangleAlert,
  },
  {
    name: "Alerts",
    href: "/dashboard/alerts",
    icon: Bell,
  },
  {
    name: "Agents",
    href: "/dashboard/agents",
    icon: Bot,
  },
];

const utilities = [
  {
    name: "Tools",
    href: "/dashboard/tools",
    icon: Wrench,
  },
];

export default function DashboardSidebar() {
  const pathname = usePathname();

  const isActive = (href: string, exact?: boolean) => {
    if (exact) {
      return pathname === href;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderLink = ({
    name,
    href,
    icon: Icon,
    exact,
  }: {
    name: string;
    href: string;
    icon: React.ElementType;
    exact?: boolean;
  }) => {
    const active = isActive(href, exact);

    return (
      <Link
        key={href}
        href={href}
        className={`
          group relative flex items-center gap-3 rounded-xl px-3 py-2.5
          text-sm font-medium
          transition-all duration-200

          ${
            active
              ? "bg-white/[0.09] text-white"
              : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
          }
        `}
      >
        {/* ACTIVE INDICATOR */}
        {active && (
          <span className="absolute -left-4 h-5 w-[2px] rounded-r-full bg-zinc-200" />
        )}

        <Icon
          size={18}
          strokeWidth={active ? 2 : 1.75}
          className={
            active
              ? "text-white"
              : "text-zinc-500 transition-colors duration-200 group-hover:text-zinc-200"
          }
        />

        <span className="flex-1">
          {name}
        </span>

        <ChevronRight
          size={14}
          className={`
            transition-all duration-200

            ${
              active
                ? "translate-x-0 text-zinc-500 opacity-100"
                : "-translate-x-1 text-zinc-600 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
            }
          `}
        />
      </Link>
    );
  };

  return (
    <aside className="
      relative z-30
      flex h-screen w-[250px] shrink-0 flex-col

      border-r border-white/[0.07]
      bg-[#101012]
    ">

      {/* =========================
          LOGO
      ========================= */}

      <div className="
        flex h-[72px] shrink-0 items-center
        border-b border-white/[0.06]
        px-5
      ">
        <Link
          href="/dashboard"
          className="flex items-center gap-3"
        >
          <div className="
            flex h-9 w-9 items-center justify-center
            rounded-xl

            border border-white/[0.08]
            bg-white/[0.04]
          ">
            <Image
              src="/logos/sentinelgrid_png.png"
              alt="SentinelGrid"
              width={25}
              height={25}
              className="h-[25px] w-[25px] object-contain"
            />
          </div>

          <div>
            <div className="
              text-[15px] font-semibold
              tracking-tight text-white
            ">
              SentinelGrid
            </div>

            <div className="
              mt-[1px]
              text-[10px] font-medium uppercase
              tracking-[0.18em]
              text-zinc-500
            ">
              Infrastructure
            </div>
          </div>
        </Link>
      </div>


      {/* =========================
          NAVIGATION
      ========================= */}

      <div className="
        flex-1 overflow-y-auto
        px-4 py-5
      ">

        {/* WORKSPACE */}

        <div>
          <p className="
            mb-2 px-3
            text-[10px] font-semibold uppercase
            tracking-[0.18em]
            text-zinc-600
          ">
            Workspace
          </p>

          <nav className="space-y-1">
            {navigation.map(renderLink)}
          </nav>
        </div>


        {/* OPERATIONS */}

        <div className="mt-7">
          <p className="
            mb-2 px-3
            text-[10px] font-semibold uppercase
            tracking-[0.18em]
            text-zinc-600
          ">
            Operations
          </p>

          <nav className="space-y-1">
            {operations.map(renderLink)}
          </nav>
        </div>


        {/* UTILITIES */}

        <div className="mt-7">
          <p className="
            mb-2 px-3
            text-[10px] font-semibold uppercase
            tracking-[0.18em]
            text-zinc-600
          ">
            Utilities
          </p>

          <nav className="space-y-1">
            {utilities.map(renderLink)}
          </nav>
        </div>

      </div>

    </aside>
  );
}