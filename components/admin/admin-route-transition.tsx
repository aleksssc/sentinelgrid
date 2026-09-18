"use client";

import { usePathname } from "next/navigation";

export function AdminRouteTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className="sg-admin-route-transition"
    >
      {children}
    </div>
  );
}