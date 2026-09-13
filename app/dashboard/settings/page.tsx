import { Settings2 } from "lucide-react";
import AppearanceSettings from "@/components/dashboard/appearance-settings";
import { PageHeader } from "@/components/dashboard/dashboard-primitives";

export default function SettingsPage() {
  return (
    <div className="sg-page-shell">
      <div className="sg-page">
        <PageHeader title="Settings" eyebrow="Your workspace, your style" description="Tune the look of SentinelGrid. No account or organization settings are changed."
          icon={<Settings2 size={23} />} />
        <AppearanceSettings />
      </div>
    </div>
  );
}
