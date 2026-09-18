import "../dashboard/dashboard-background.css";
import "../dashboard/dashboard-design.css";
import "../dashboard/dashboard-themes.css";
import "../dashboard/dashboard-interface.css";
import "../dashboard/information-style.css";
import "../dashboard/information-style-overrides.css";
import "./admin.css";
import "./admin-filter-bar.css";

import { requirePlatformAdmin } from "@/lib/platform-access";

import {
  AdminDesktopNavigation,
  AdminMobileNavigation,
} from "@/components/admin/admin-navigation";

import {
  AdminRouteTransition,
} from "@/components/admin/admin-route-transition";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role =
    await requirePlatformAdmin();

  const roleLabel =
    role === "developer"
      ? "Developer"
      : "Platform Admin";

  return (
    <div className="sg-dashboard sg-admin min-h-dvh bg-[#08090b] text-white">
      <AdminMobileNavigation
        roleLabel={roleLabel}
      />

      <div className="sg-admin-layout">
        <AdminDesktopNavigation
          roleLabel={roleLabel}
        />

        <main className="sg-admin-main">
          <div className="sg-admin-content">
            <AdminRouteTransition>
              {children}
            </AdminRouteTransition>
          </div>
        </main>
      </div>
    </div>
  );
}