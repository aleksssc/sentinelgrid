import type { ReactNode } from "react";
import DashboardBackground from "@/components/dashboard/dashboard-background";
import "@/app/dashboard/dashboard-background.css";
import "@/app/dashboard/dashboard-themes.css";
import "./onboarding-shell.css";

export default function OnboardingShell({
  children,
  embedded = false,
}: {
  children: ReactNode;
  embedded?: boolean;
}) {
  return (
    <main className={`sg-dashboard sg-onboarding relative isolate flex shrink-0 items-center justify-center text-white ${embedded ? "-mx-6 -my-12 min-h-[calc(100svh-4rem)] w-[calc(100%+3rem)] px-6 py-12" : "min-h-svh w-full px-6 py-8"}`}>
      <DashboardBackground />
      <div className="sg-onboarding-content relative z-10 flex w-full justify-center">
        {children}
      </div>
    </main>
  );
}
