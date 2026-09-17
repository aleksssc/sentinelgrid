"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessCanCreateResource, accessHasPermission, getOrganizationAccess } from "@/lib/organization-access";
import { getOrganizationEntitlements } from "@/lib/billing/entitlements";
export type InviteMemberState = { error?: string; success?: string };
export async function inviteMemberAction(organizationId: string, _previousState: InviteMemberState, formData: FormData): Promise<InviteMemberState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (role !== "admin" && role !== "member") return { error: "Invalid role." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };
  const access = await getOrganizationAccess(organizationId);
  if (!access || !accessHasPermission(access, "members.manage")) return { error: "Only the organization owner can invite members." };
  const { data: organization, error: organizationError } = await supabase.from("organizations").select("id,name,owner_id").eq("id", organizationId).single();
  if (organizationError || !organization) return { error: "Organization not found." };
  const { data: inviteeState, error: inviteeError } = await supabase.rpc("get_organization_invitee_state", { p_organization_id: organizationId, p_email: email });
  if (inviteeError || !["member", "existing_user", "new_user"].includes(inviteeState)) {
    console.error("Invitee state lookup failed", inviteeError);
    return { error: "Unable to check invitation eligibility." };
  }
  if (inviteeState === "member") return { error: "This user is already a member of the organization." };
  const { error: expireError } = await supabase.from("organization_invites").update({ status: "expired" }).eq("organization_id", organizationId).eq("status", "pending").lte("expires_at", new Date().toISOString());
  if (expireError) { console.error("Invitation expiration failed", expireError); return { error: "Unable to check pending invitations." }; }
  const entitlements = await getOrganizationEntitlements(organizationId);
  if (!accessCanCreateResource(access, "members", entitlements.usage.members + entitlements.pendingInvites)) return { error: `Member limit reached, ${entitlements.limits.members} Members. Pending invitations reserve seats. Upgrade your plan to invite more members.` };
  const { data: invitation, error: invitationError } = await supabase.from("organization_invites").insert({ organization_id: organizationId, email, role, invited_by: user.id, status: "pending", expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }).select("id,token").single();
  if (invitationError || !invitation) {
    console.error("Invitation creation failed", invitationError);
    return { error: invitationError?.code === "23505" ? "This email already has a pending invitation." : invitationError?.message.includes("LIMIT_REACHED") ? "Member limit reached. Upgrade your plan to invite more members." : "Unable to create invitation." };
  }
  if (inviteeState === "new_user") {
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    if (!site) {
      const { error: cleanupError } = await supabase.from("organization_invites").delete().eq("id", invitation.id).eq("status", "pending");
      if (cleanupError) console.error("Invitation cleanup failed", cleanupError);
      return { error: "Invitation email is not configured. Contact support." };
    }
    const { error: emailError } = await createAdminClient().auth.admin.inviteUserByEmail(email, { redirectTo: new URL("/auth/invite", site).toString(), data: { organization_invite_token: invitation.token, organization_id: organizationId, organization_name: organization.name, organization_role: role } });
    if (emailError) {
      const { error: cleanupError } = await supabase.from("organization_invites").delete().eq("id", invitation.id).eq("status", "pending");
      if (cleanupError) console.error("Invitation cleanup failed", cleanupError);
      console.error("Invitation email failed", emailError);
      return { error: "Unable to send invitation email. Please retry." };
    }
  }
  revalidatePath("/dashboard", "layout");
  return { success: `${email} has been invited.` };
}
