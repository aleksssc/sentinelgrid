import { Settings2 } from "lucide-react";

import AppearanceSettings from "@/components/dashboard/appearance-settings";

import {
  PageHeader,
} from "@/components/dashboard/dashboard-primitives";

export default function SettingsPage() {
  return (
    <div className="sg-page-shell">
      <div className="sg-page">
        <PageHeader
          title="Settings"
          eyebrow="Workspace"
          description="Customize the SentinelGrid interface on this browser."
          icon={
            <Settings2 size={23} />
          }
        />

        <AppearanceSettings />
      </div>
    </div>
  );
}