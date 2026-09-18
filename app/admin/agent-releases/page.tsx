import { createAdminClient } from "@/lib/supabase/admin";
import { isExpectedUpdateResult } from "@/lib/agent/update-status";
import {
  AdminReleaseInventory,
  type AdminReleaseRow,
} from "@/components/admin/admin-release-inventory";
import {
  AdminMetricStrip,
  AdminPageHeader,
  AdminSection,
} from "@/components/admin/admin-primitives";

type Release = {
  id: string;
  version: string;
  channel: string;
  is_active: boolean | null;
  published_at: string | null;
  architecture: string | null;
};

type Bundle = {
  release_id: string;
  msi_size_bytes: number | null;
  signer_sha256: string | null;
  development_build: boolean | null;
};

type Device = { agent_version: string | null };
type UpdateResult = { error_code: string | null };

export default async function AdminAgentReleasesPage() {
  const admin = createAdminClient();

  const [
    { data: releases, error },
    { data: bundles, error: bundlesError },
    { data: devices },
    { data: updateResults, error: updatesError },
  ] = await Promise.all([
    admin
      .from("agent_releases")
      .select("id, version, channel, is_active, published_at, architecture")
      .order("published_at", { ascending: false })
      .limit(100)
      .returns<Release[]>(),
    admin
      .from("agent_release_bundles")
      .select("release_id, msi_size_bytes, signer_sha256, development_build")
      .returns<Bundle[]>(),
    admin.from("devices").select("agent_version").returns<Device[]>(),
    admin
      .from("device_commands")
      .select("error_code")
      .eq("command_type", "update_agent")
      .eq("status", "failed")
      .limit(1000)
      .returns<UpdateResult[]>(),
  ]);

  const versionCounts = new Map<string, number>();
  for (const device of devices ?? []) {
    if (!device.agent_version) continue;
    versionCounts.set(device.agent_version, (versionCounts.get(device.agent_version) ?? 0) + 1);
  }

  const failures = updateResults
    ? updateResults.filter((command) => !isExpectedUpdateResult(command.error_code)).length
    : null;

  const currentStable = (releases ?? []).find(
    (release) => release.channel === "stable" && release.is_active,
  );
  const currentBeta = (releases ?? []).find(
    (release) => release.channel === "beta" && release.is_active,
  );

  const inventory: AdminReleaseRow[] = (releases ?? []).map((release) => {
    const bundle = bundles?.find((item) => item.release_id === release.id);
    const current =
      release.id === currentStable?.id || release.id === currentBeta?.id;

    return {
      id: release.id,
      version: release.version,
      channel: release.channel,
      state: current ? "Current" : release.is_active ? "Available" : "Archived",
      publishedAt: release.published_at,
      build: `${bundle?.development_build ? "Development" : "Production"}${
        bundle?.msi_size_bytes
          ? ` · ${(bundle.msi_size_bytes / 1024 / 1024).toFixed(1)} MB`
          : ""
      }`,
      signer: bundle?.signer_sha256
        ? `${bundle.signer_sha256.slice(0, 12)}…`
        : "Not available",
      devices: versionCounts.get(release.version) ?? 0,
    };
  });

  const totalDevices = devices?.length ?? 0;
  const currentStableDevices = currentStable
    ? versionCounts.get(currentStable.version) ?? 0
    : 0;

  return (
    <>
      <AdminPageHeader
        eyebrow="Operations"
        title="Agent Releases"
        description="Release state, signing information and fleet adoption."
      />

      <AdminMetricStrip
        label="Agent release summary"
        items={[
          {
            label: "Current stable",
            value: currentStable ? `v${currentStable.version}` : "None",
            tone: currentStable ? "success" : "neutral",
          },
          {
            label: "Stable adoption",
            value: currentStable ? `${currentStableDevices}/${totalDevices}` : "—",
            meta: "devices on current stable",
          },
          {
            label: "Current beta",
            value: currentBeta ? `v${currentBeta.version}` : "None",
            tone: currentBeta ? "info" : "neutral",
          },
          {
            label: "Update failures",
            value: updatesError ? "—" : failures ?? 0,
            tone: failures ? "danger" : "neutral",
          },
        ]}
      />

      <AdminSection
        className="sg-admin-inventory"
        title="Release history"
        description="Current releases are derived from the active release in each channel."
      >
        {error || bundlesError ? (
          <div role="alert" className="sg-inline-notice">
            Release inventory could not be loaded:{" "}
            {(error ?? bundlesError)?.message ?? "Unknown database error"}
          </div>
        ) : (
          <AdminReleaseInventory releases={inventory} />
        )}
      </AdminSection>
    </>
  );
}
