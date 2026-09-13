import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { browserRDPSession, RDPError, rdpError } from "@/lib/remote/rdp";
import { effectiveChannel } from "@/lib/agent/update-policy";

export async function GET(request: NextRequest) {
 try {
  const deviceId=request.nextUrl.searchParams.get("deviceId")??"", sessionId=request.nextUrl.searchParams.get("sessionId")??"";
  const session=await browserRDPSession(deviceId,sessionId), admin=createAdminClient();
  const {data:policy,error:policyError}=await admin.from("organization_agent_update_settings").select("channel").eq("organization_id",session.organization_id).maybeSingle(); if(policyError)throw new Error("DOWNLOAD_POLICY_FAILED");
  const channel=effectiveChannel(policy?.channel??"stable"); const {data:head,error:headError}=await admin.from("agent_release_channels").select("release_id").eq("channel",channel).maybeSingle();if(headError||!head)throw new RDPError("REMOTE_DOWNLOAD_UNAVAILABLE",503);
  const {data:release,error:releaseError}=await admin.from("agent_releases").select("version,channel,is_active").eq("id",head.release_id).single();if(releaseError||!release?.is_active||release.channel!==channel)throw new RDPError("REMOTE_DOWNLOAD_UNAVAILABLE",503);
  const {data:signed,error:signError}=await admin.storage.from("agent-releases").createSignedUrl(`${channel}/${release.version}/SentinelGridRDP.exe`,120,{download:"SentinelGridRemote.exe"});if(signError||!signed)throw new Error("REMOTE_DOWNLOAD_UNAVAILABLE");
  return NextResponse.redirect(signed.signedUrl,{status:302,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
 }catch(error){return rdpError(error)}
}
