import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveChannel } from "@/lib/agent/update-policy";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || !/^SG-ENROLL-[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ error: "Invalid enrollment token." }, { status: 400, headers });
  }
  try {
    const admin = createAdminClient();
    const { data: enrollment, error: tokenError } = await admin.from("agent_enrollment_tokens")
      .select("organization_id, expires_at, used_at, revoked_at")
      .eq("token_hash", createHash("sha256").update(token).digest("hex")).maybeSingle();
    if (tokenError) throw new Error("ENROLLMENT_LOOKUP_FAILED");
    if (!enrollment || enrollment.used_at || enrollment.revoked_at ||
        !Number.isFinite(Date.parse(enrollment.expires_at)) || Date.parse(enrollment.expires_at) <= Date.now()) {
      return NextResponse.json({ error: "Enrollment token is unavailable." }, { status: 401, headers });
    }
    const { data: policy, error: policyError } = await admin.from("organization_agent_update_settings")
      .select("channel").eq("organization_id", enrollment.organization_id).maybeSingle();
    if (policyError) throw new Error("INSTALLER_POLICY_LOOKUP_FAILED");
    const channel = effectiveChannel(policy?.channel ?? "stable");
    const { data: head, error: headError } = await admin.from("agent_release_channels")
      .select("release_id").eq("channel", channel).maybeSingle();
    if (headError) throw new Error("INSTALLER_CHANNEL_LOOKUP_FAILED");
    if (!head) return NextResponse.json({ error: "No installer has been published for this channel." }, { status: 503, headers });
    const { data: release, error: releaseError } = await admin.from("agent_releases")
      .select("version, channel, platform, architecture, is_active").eq("id", head.release_id).single();
    if (releaseError || !release || !release.is_active || release.channel !== channel ||
        release.platform !== "windows" || release.architecture !== "amd64" || !/^\d+\.\d+\.\d+$/.test(release.version)) {
      throw new Error("INVALID_PUBLISHED_INSTALLER");
    }
    const filename = `SentinelGridAgent__${token}.msi`;
    const ttl = Math.min(120, Math.floor((Date.parse(enrollment.expires_at) - Date.now()) / 1000));
    if (ttl < 1) return NextResponse.json({ error: "Enrollment token expired." }, { status: 401, headers });
    const { data: signed, error: signError } = await admin.storage.from("agent-releases")
      .createSignedUrl(`${channel}/${release.version}/SentinelGridAgent.msi`, ttl, { download: filename });
    if (signError || !signed) throw new Error("INSTALLER_DOWNLOAD_UNAVAILABLE");
    const url = new URL(signed.signedUrl);
    const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (url.protocol !== "https:" || url.origin !== storage.origin) throw new Error("INVALID_STORAGE_ORIGIN");
    return new NextResponse(null, { status: 302, headers: {
      ...headers, Location: url.href, "X-SentinelGrid-Version": release.version, "X-SentinelGrid-Channel": channel,
    } });
  } catch (error) {
    // Never log tokenized requests or signed storage URLs.
    console.error("[Installer download]", error instanceof Error ? error.message : "INSTALLER_FAILED");
    return NextResponse.json({ error: "Installer delivery is unavailable." }, { status: 503, headers });
  }
}
