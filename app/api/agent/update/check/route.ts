import { authenticateUpdateAgent, UpdateAPIError, updateErrorResponse } from "@/lib/agent/update-auth";
import { effectiveChannel, parseVersion, selectRelease, type AgentRelease } from "@/lib/agent/update-policy";

export async function POST(request: Request) {
  try {
    const { admin, device, organizationId } = await authenticateUpdateAgent(request);
    const { data: permitted, error: rateError } = await admin.rpc("claim_agent_update_check", { p_device_id: device.id });
    if (rateError) throw new UpdateAPIError("UPDATE_RATE_LIMIT_FAILED", 503);
    if (!permitted) throw new UpdateAPIError("RATE_LIMITED", 429);
    // Identity and installed version come from authenticated inventory, never an organization ID in the body.
    try { parseVersion(device.agent_version); } catch { throw new UpdateAPIError("AGENT_VERSION_REQUIRED", 409); }
    const { data: settings, error: policyError } = await admin.from("organization_agent_update_settings")
      .select("automatic_updates, channel, update_delay_hours").eq("organization_id", organizationId).maybeSingle();
    if (policyError) throw new UpdateAPIError("UPDATE_POLICY_FAILED", 503);
    const channel = effectiveChannel(settings?.channel ?? "stable");
    const automatic = settings?.automatic_updates ?? true;
    const delay = settings?.update_delay_hours ?? 0;
    const cutoff = new Date(Date.now() - delay * 3600000).toISOString();
    const { data: releases, error: releaseError } = await admin.from("agent_releases")
      .select("id, version, channel, platform, architecture, storage_path, sha256, size_bytes, published_at")
      .eq("channel", channel).eq("platform", "windows").eq("architecture", "amd64").eq("is_active", true)
      .lte("published_at", cutoff).limit(501);
    if (releaseError || !releases || releases.length > 500) throw new UpdateAPIError("RELEASE_LOOKUP_FAILED", 503);
    const release = selectRelease(releases as AgentRelease[], device.agent_version, channel);
    const enabled = process.env.SENTINELGRID_AGENT_UPDATES_ENABLED === "true";
    const capability = device.capabilities?.agent_update === true;
    const base = {
      product: "SentinelGridAgent", platform: "windows", architecture: "amd64",
      current_version: device.agent_version, latest_version: release?.version ?? device.agent_version,
      update_available: !!release, channel, automatic_updates: automatic,
      installation_enabled: enabled && capability,
    };
    const { error: stateError } = await admin.from("device_agent_update_state").upsert({
      device_id: device.id, latest_version: release?.version ?? device.agent_version,
      effective_channel: channel, last_check_at: new Date().toISOString(),
    }, { onConflict: "device_id" });
    if (stateError) throw new UpdateAPIError("UPDATE_STATE_FAILED", 503);
    if (!release || !enabled || !capability) {
      return Response.json(base, { headers: { "Cache-Control": "no-store" } });
    }
    const ttl = 900;
    const { data: signed, error: signError } = await admin.storage.from("agent-releases").createSignedUrl(release.storage_path, ttl);
    if (signError || !signed) throw new UpdateAPIError("RELEASE_DOWNLOAD_UNAVAILABLE", 503);
    const url = new URL(signed.signedUrl);
    if (url.protocol !== "https:") throw new UpdateAPIError("INVALID_STORAGE_CONFIGURATION", 503);
    return Response.json({ ...base, release_id: release.id, sha256: release.sha256, size_bytes: release.size_bytes,
      download_url: signed.signedUrl, expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return updateErrorResponse(error);
  }
}
