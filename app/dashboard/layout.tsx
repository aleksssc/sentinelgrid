import { OrganizationSelector } from "@/components/organization/organization-selector";

import { Suspense } from "react";
import { redirect } from "next/navigation";

import "./dashboard-background.css";
import "./dashboard-design.css";
import "./dashboard-themes.css";
import "./dashboard-interface.css";
import "./information-style.css";
import "./information-style-overrides.css";

import DashboardSidebar from "@/components/dashboard/dashboard-sidebar";
import DashboardBackground from "@/components/dashboard/dashboard-background";
import InfrastructureSearch from "@/components/infrastructure-search";

import NotificationsBell from "@/components/dashboard/notifications/notifications-bell";

import { UserMenu } from "@/components/user-menu";

import { getOrganizationContext } from "@/lib/organization-context";
import { getOrganizationEntitlements } from "@/lib/billing/entitlements";

function NotificationFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-9 w-9 rounded-lg border border-white/10 bg-white/[0.025]"
    />
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    user,
    organization,
    organizations,
  } =
    await getOrganizationContext();

  /* =========================================================
     AUTH
  ========================================================== */

  if (!user) {
    redirect("/auth/login");
  }

  /* =========================================================
     ORGANIZATION SELECTION
  ========================================================== */

  if (
    !organization &&
    organizations.some(
      (item) =>
        item.setup_completed
    )
  ) {
    return (
      <main className="p-8">
        <h1 className="mb-4 text-xl">
          Select an organization
        </h1>

        <OrganizationSelector
          organizations={
            organizations
          }
        />
      </main>
    );
  }

  if (!organization) {
    redirect("/onboarding");
  }

  /* =========================================================
     CURRENT ORGANIZATION PLAN
  ========================================================== */

  const entitlements =
    await getOrganizationEntitlements(
      organization.id
    );

  const plan =
    entitlements.plan;

  /* =========================================================
     DASHBOARD
  ========================================================== */

  return (
    <div className="sg-dashboard relative flex h-dvh overflow-hidden bg-[#0a0a0c] text-white">
      <a
        href="#dashboard-content"
        className="sg-skip-link"
      >
        Skip to content
      </a>

      <DashboardBackground />

      <DashboardSidebar
        organizationId={
          organization.id
        }
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">

        {/* =================================================
            TOP BAR
        ================================================== */}

        <header className="sg-topbar relative z-30 flex h-[72px] shrink-0 items-center gap-3 border-b border-surface-edge bg-surface-inset px-3 backdrop-blur-xl sm:px-6">

          {/* SEARCH */}

          <div className="flex min-w-0 flex-1 items-center">
            <InfrastructureSearch />
          </div>

          {/* RIGHT */}

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">

            <Suspense
              fallback={
                <NotificationFallback />
              }
            >
              <NotificationsBell />
            </Suspense>

            <div className="mx-1 hidden h-5 w-px bg-surface-edge sm:block" />

            {organizations.length >
              1 && (
              <OrganizationSelector
                organizations={
                  organizations
                }
                selectedId={
                  organization.id
                }
              />
            )}

            <UserMenu
              plan={plan}
            />
          </div>
        </header>

        {/* =================================================
            CONTENT
        ================================================== */}

        <main
          id="dashboard-content"
          tabIndex={-1}
          className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          {children}
        </main>
      </div>
    </div>
  );
}