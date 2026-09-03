"use client";

import Link from "next/link";
import Image from "next/image";

import {
  useEffect,
  useState,
} from "react";

import {
  usePathname,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/client";

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

// ============================================================
// STATIC NAVIGATION
// ============================================================

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

// ============================================================
// SIDEBAR
// ============================================================

export default function DashboardSidebar() {
  const pathname = usePathname();

  const [
    organizationId,
    setOrganizationId,
  ] = useState<string | null>(
    null
  );

  const [
    loadingOrganization,
    setLoadingOrganization,
  ] = useState(true);

  // ============================================================
  // LOAD CURRENT ORGANIZATION
  // ============================================================

  useEffect(() => {
    let mounted = true;

    async function loadOrganization() {
      try {
        const supabase =
          createClient();

        // RLS deve devolver apenas
        // organizations acessíveis ao user.
        const {
          data,
          error,
        } = await supabase
          .from("organizations")
          .select("id")
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error(
            "Sidebar organization error:",
            error
          );

          return;
        }

        if (
          mounted &&
          data?.id
        ) {
          setOrganizationId(
            data.id
          );
        }
      } catch (error) {
        console.error(
          "Sidebar organization load error:",
          error
        );
      } finally {
        if (mounted) {
          setLoadingOrganization(
            false
          );
        }
      }
    }

    loadOrganization();

    return () => {
      mounted = false;
    };
  }, []);

  // ============================================================
  // NAVIGATION
  // ============================================================

  const navigation = [
    {
      name: "Overview",
      href: "/dashboard",
      icon: LayoutDashboard,
      exact: true,
      disabled: false,
    },

    {
      name: "Clients",

      // IMPORTANTE:
      // já não passa por
      // /dashboard/organizations

      href: organizationId
        ? `/dashboard/organizations/${organizationId}`
        : "/dashboard",

      icon: Building2,
      disabled:
        loadingOrganization ||
        !organizationId,
    },

    {
      name: "Monitors",
      href: "/dashboard/monitors",
      icon: Activity,
      disabled: false,
    },

    {
      name: "Domains & DNS",
      href: "/dashboard/domains",
      icon: Globe2,
      disabled: false,
    },
  ];

  // ============================================================
  // ACTIVE STATE
  // ============================================================

  const isActive = (
    href: string,
    exact?: boolean,
    name?: string
  ) => {
    // =========================
    // CLIENTS
    // =========================

    if (
      name === "Clients"
    ) {
      return pathname.startsWith(
        "/dashboard/organizations/"
      );
    }

    // =========================
    // EXACT
    // =========================

    if (exact) {
      return pathname === href;
    }

    // =========================
    // NORMAL
    // =========================

    return (
      pathname === href ||
      pathname.startsWith(
        `${href}/`
      )
    );
  };

  // ============================================================
  // RENDER LINK
  // ============================================================

  const renderLink = ({
    name,
    href,
    icon: Icon,
    exact,
    disabled = false,
  }: {
    name: string;
    href: string;
    icon: React.ElementType;
    exact?: boolean;
    disabled?: boolean;
  }) => {
    const active =
      !disabled &&
      isActive(
        href,
        exact,
        name
      );

    return (
      <Link
        key={name}
        href={
          disabled
            ? pathname
            : href
        }
        aria-disabled={
          disabled
        }
        tabIndex={
          disabled
            ? -1
            : undefined
        }
        className={`
          group relative
          flex items-center gap-3

          rounded-xl

          px-3 py-2.5

          text-sm font-medium

          transition-all duration-200

          ${
            disabled
              ? "pointer-events-none text-zinc-600"
              : active
                ? "bg-white/[0.09] text-white"
                : "text-zinc-400 hover:bg-white/[0.05] hover:text-white"
          }
        `}
      >

        {/* =========================
            ACTIVE INDICATOR
        ========================= */}

        {active && (
          <span
            className="
              absolute -left-4
              h-5 w-[2px]
              rounded-r-full
              bg-zinc-200
            "
          />
        )}

        {/* =========================
            ICON
        ========================= */}

        <Icon
          size={18}
          strokeWidth={
            active
              ? 2
              : 1.75
          }
          className={
            disabled
              ? "text-zinc-700"
              : active
                ? "text-white"
                : "text-zinc-500 transition-colors duration-200 group-hover:text-zinc-200"
          }
        />

        {/* =========================
            NAME
        ========================= */}

        <span className="flex-1">
          {name}
        </span>

        {/* =========================
            ARROW
        ========================= */}

        {!disabled && (
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
        )}

      </Link>
    );
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <aside
      className="
        relative z-30
        flex h-screen w-[250px]
        shrink-0 flex-col

        border-r border-white/[0.07]
        bg-[#101012]
      "
    >

      {/* ======================================================
          LOGO
      ====================================================== */}

      <div
        className="
          flex h-[72px]
          shrink-0 items-center

          border-b border-white/[0.06]

          px-5
        "
      >

        <Link
          href="/dashboard"
          className="
            flex items-center gap-3
          "
        >

          <div
            className="
              flex h-9 w-9
              items-center justify-center

              rounded-xl

              border border-white/[0.08]
              bg-white/[0.04]
            "
          >

            <Image
              src="/logos/sentinelgrid_png.png"
              alt="SentinelGrid"
              width={25}
              height={25}
              className="
                h-[25px] w-[25px]
                object-contain
              "
            />

          </div>

          <div>

            <div
              className="
                text-[15px]
                font-semibold
                tracking-tight
                text-white
              "
            >
              SentinelGrid
            </div>

            <div
              className="
                mt-[1px]

                text-[10px]
                font-medium
                uppercase

                tracking-[0.18em]

                text-zinc-500
              "
            >
              Infrastructure
            </div>

          </div>

        </Link>

      </div>

      {/* ======================================================
          NAVIGATION
      ====================================================== */}

      <div
        className="
          flex-1
          overflow-y-auto

          px-4 py-5
        "
      >

        {/* =========================
            WORKSPACE
        ========================= */}

        <div>

          <p
            className="
              mb-2 px-3

              text-[10px]
              font-semibold
              uppercase

              tracking-[0.18em]

              text-zinc-600
            "
          >
            Workspace
          </p>

          <nav className="space-y-1">
            {navigation.map(
              renderLink
            )}
          </nav>

        </div>

        {/* =========================
            OPERATIONS
        ========================= */}

        <div className="mt-7">

          <p
            className="
              mb-2 px-3

              text-[10px]
              font-semibold
              uppercase

              tracking-[0.18em]

              text-zinc-600
            "
          >
            Operations
          </p>

          <nav className="space-y-1">
            {operations.map(
              renderLink
            )}
          </nav>

        </div>

        {/* =========================
            UTILITIES
        ========================= */}

        <div className="mt-7">

          <p
            className="
              mb-2 px-3

              text-[10px]
              font-semibold
              uppercase

              tracking-[0.18em]

              text-zinc-600
            "
          >
            Utilities
          </p>

          <nav className="space-y-1">
            {utilities.map(
              renderLink
            )}
          </nav>

        </div>

      </div>

    </aside>
  );
}