import { authenticateUpdateAgent, UpdateAPIError, updateErrorResponse } from "@/lib/agent/update-auth";
import { effectiveChannel, parseVersion, selectRelease } from "@/lib/agent/update-policy";
import { productArtifact, type ProductRelease } from "@/lib/agent/product-release";

export async function POST(request: Request) {
  try {
    const { admin, device, organizationId } = await authenticateUpdateAgent(request);
    const { data: permitted, error: rateError } = await admin.rpc("claim_agent_update_check", { p_device_id: device.id });
    if (rateError) throw new UpdateAPIError("UPDATE_RATE_LIMIT_FAILED", 503);
    if (!permitted) throw new UpdateAPIError("RATE_LIMITED", 429);
    // Identity and installed version come from authenticated inventory, never the request body.
    try { parseVersion(device.agent_version); } catch { throw new UpdateAPIError("AGENT_VERSION_REQUIRED", 409); }
    const { data: settings, error: policyError } = await admin.from("organization_agent_update_settings")
      .select("automatic_updates, channel, update_delay_hours").eq("organization_id", organizationId).maybeSingle();
    if (policyError) throw new UpdateAPIError("UPDATE_POLICY_FAILED", 503);
    const channel = effectiveChannel(settings?.channel ?? "stable");
    const automatic = settings?.automatic_updates ?? true;
    const delay = settings?.update_delay_hours ?? 0;
    const cutoff = new Date(Date.now() - delay * 3600000).toISOString();
    const { data: releases, error: releaseError } = await admin.from("agent_releases")
      .select("id, version, channel, platform, architecture, storage_path, sha256, size_bytes, published_at, msi_sha256, msi_size_bytes, manifest_sha256, signer_sha256")
      .eq("channel", channel).eq("platform", "windows").eq("architecture", "amd64").eq("is_active", true)
      .lte("published_at", cutoff).limit(501);
    if (releaseError || !releases || releases.length > 500) throw new UpdateAPIError("RELEASE_LOOKUP_FAILED", 503);
    const release = selectRelease(releases as ProductRelease[], device.agent_version, channel);
    const enabled = process.env.SENTINELGRID_AGENT_UPDATES_ENABLED === "true";
    const capability = device.capabilities?.agent_update === true;
    // Negotiation is not authority: all policy, metadata and signing requirements remain server-derived.
    // Old EXE-only Agents must never receive an MSI disguised as candidate.exe.
    const compatible = request.headers.get("X-SentinelGrid-Update-Protocol") === "2";
    const base = {
      product: "SentinelGridAgent", platform: "windows", architecture: "amd64",
      current_version: device.agent_version, latest_version: release?.version ?? device.agent_version,
      update_available: !!release, channel, automatic_updates: automatic,
      installation_enabled: enabled && capability && compatible,
      bootstrap_required: !compatible, update_protocol: 2,
    };
    const { error: stateError } = await admin.from("device_agent_update_state").upsert({
      device_id: device.id, latest_version: release?.version ?? device.agent_version,
      effective_channel: channel, last_check_at: new Date().toISOString(),
    }, { onConflict: "device_id" });
    if (stateError) throw new UpdateAPIError("UPDATE_STATE_FAILED", 503);
    if (!release || !enabled || !capability || !compatible) {
      return Response.json(base, { headers: { "Cache-Control": "no-store" } });
    }
    const metadata = releases.find((item) => item.id === release.id);
    if (!metadata) throw new UpdateAPIError("RELEASE_LOOKUP_FAILED", 503);
    const storage = admin.storage.from("agent-releases");
    const { data: manifest, error: manifestError } = await storage.download(`${channel}/${release.version}/manifest.json`);
    if (manifestError || !manifest || manifest.size > 16384) throw new UpdateAPIError("RELEASE_MANIFEST_UNAVAILABLE", 503);
    let artifact;
    try { artifact = productArtifact(metadata, new Uint8Array(await manifest.arrayBuffer())); }
    catch { throw new UpdateAPIError("PRODUCT_RELEASE_NOT_QUALIFIED", 503); }
    const ttl = 900;
    const { data: signed, error: signError } = await storage.createSignedUrl(artifact.storage_path, ttl);
    if (signError || !signed) throw new UpdateAPIError("RELEASE_DOWNLOAD_UNAVAILABLE", 503);
    const url = new URL(signed.signedUrl);
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (url.protocol !== "https:" || url.origin !== origin.origin) throw new UpdateAPIError("INVALID_STORAGE_CONFIGURATION", 503);
    return Response.json({ ...base, release_id: release.id, artifact_type: artifact.artifact_type,
      sha256: artifact.sha256, size_bytes: artifact.size_bytes, signer_sha256: artifact.signer_sha256,
      download_url: signed.signedUrl, expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return updateErrorResponse(error);
  }
}
