import { RoleBadge, StatusBadge } from "@/components/dashboard/dashboard-badges";
import { PageHeader, SectionHeader, Surface, EmptyState } from "@/components/dashboard/dashboard-primitives";
import { FormSubmitButton } from "@/components/dashboard/form-submit-button";
import Link from "next/link";

import { connection } from "next/server";

import {
  notFound,
  redirect,
} from "next/navigation";

import { revalidatePath } from "next/cache";

import { inviteMemberAction } from "../members/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuditLog } from "@/lib/audit/create-audit-log";
import { SettingsNotice } from "@/components/organization/settings-notice";
import { RemoveMemberButton } from "@/components/organization/remove-member-button";
import { InviteMemberButton } from "@/components/organization/invite-member-button";
import { DeleteOrganizationButton } from "@/components/organization/delete-organization-button";

import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Crown,
  Settings,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

/* =========================================================
                          TYPES
========================================================= */

type TeamMember = {
  id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  display_name: string;
  display_email: string;
};

/* =========================================================
                          PAGE
========================================================= */

export default async function OrganizationSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{
    id: string;
  }>;

  searchParams: Promise<{
    notice?: string;
    inviteError?: string;
  }>;
}) {
  await connection();

  const { id } =
    await params;

  const query =
    await searchParams;

  const notice =
    query.notice ?? null;

  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  /* =========================================================
                          USER
  ========================================================== */

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  /* =========================================================
                      ORGANIZATION
  ========================================================== */

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select("*")
    .eq(
      "id",
      id
    )
    .eq(
      "owner_id",
      user.id
    )
    .single();

  if (
    organizationError ||
    !organization
  ) {
    notFound();
  }

  /* =========================================================
                          OWNER USER
  ========================================================== */

  const {
    data: ownerAuthData,
    error: ownerAuthError,
  } =
    await admin.auth.admin.getUserById(
      organization.owner_id
    );

  if (ownerAuthError) {
    console.error(
      "Owner auth error:",
      ownerAuthError
    );
  }

  const ownerAuthUser =
    ownerAuthData?.user ??
    null;

  const ownerDisplayName =
    ownerAuthUser
      ?.user_metadata
      ?.full_name ||
    ownerAuthUser
      ?.user_metadata
      ?.name ||
    ownerAuthUser
      ?.email
      ?.split("@")[0] ||
    "Organization owner";

  const ownerDisplayEmail =
    ownerAuthUser?.email ??
    "";

  /* =========================================================
                          MEMBERS
  ========================================================== */

  const {
    data: members,
    error: membersError,
  } = await supabase
    .from(
      "organization_members"
    )
    .select(`
      id,
      user_id,
      role,
      joined_at
    `)
    .eq(
      "organization_id",
      organization.id
    )
    .order(
      "joined_at",
      {
        ascending: true,
      }
    );

  if (membersError) {
    console.error(
      "Organization members error:",
      membersError
    );
  }

  /* =========================================================
                    MEMBER USER DETAILS
  ========================================================== */

  const membersWithUsers:
    TeamMember[] =
    await Promise.all(
      (members ?? [])
        .filter(
          (member) =>
            member.user_id !==
            organization.owner_id
        )
        .map(
          async (
            member
          ) => {
            const {
              data,
              error,
            } =
              await admin.auth.admin.getUserById(
                member.user_id
              );

            if (
              error ||
              !data.user
            ) {
              console.error(
                "Member auth user error:",
                error
              );

              return {
                ...member,

                display_name:
                  "Unknown user",

                display_email:
                  "",
              };
            }

            const authUser =
              data.user;

            return {
              ...member,

              display_name:
                authUser
                  .user_metadata
                  ?.full_name ||
                authUser
                  .user_metadata
                  ?.name ||
                authUser
                  .email
                  ?.split("@")[0] ||
                "User",

              display_email:
                authUser.email ??
                "",
            };
          }
        )
    );

  /* =========================================================
                      PENDING INVITES
  ========================================================== */

  const {
    data: invites,
    error: invitesError,
  } = await supabase
    .from(
      "organization_invites"
    )
    .select(`
      id,
      email,
      role,
      status,
      created_at,
      expires_at
    `)
    .eq(
      "organization_id",
      organization.id
    )
    .eq(
      "status",
      "pending"
    )
    .order(
      "created_at",
      {
        ascending: false,
      }
    );

  if (invitesError) {
    console.error(
      "Organization invites error:",
      invitesError
    );
  }

  /* =========================================================
                    UPDATE ORGANIZATION
  ========================================================== */

  async function updateOrganization(
    formData: FormData
  ) {
    "use server";

    const supabase =
      await createClient();

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      redirect(
        "/auth/login"
      );
    }

    const organizationId =
      String(
        formData.get(
          "organization_id"
        ) || ""
      );

    const name =
      String(
        formData.get(
          "name"
        ) || ""
      ).trim();

    const description =
      String(
        formData.get(
          "description"
        ) || ""
      ).trim();

    if (!name) {
      return;
    }

    /* =========================
       CONFIRM OWNER
    ========================= */

    const {
      data:
        ownedOrganization,
    } = await supabase
      .from(
        "organizations"
      )
      .select("id")
      .eq(
        "id",
        organizationId
      )
      .eq(
        "owner_id",
        user.id
      )
      .single();

    if (
      !ownedOrganization
    ) {
      return;
    }

    /* =========================
       DUPLICATE NAME
    ========================= */

    const {
      data:
        duplicateOrganization,
    } = await supabase
      .from(
        "organizations"
      )
      .select("id")
      .eq(
        "owner_id",
        user.id
      )
      .ilike(
        "name",
        name
      )
      .neq(
        "id",
        organizationId
      )
      .maybeSingle();

    if (
      duplicateOrganization
    ) {
      console.error(
        "Another organization with this name already exists."
      );

      return;
    }

    /* =========================
       UPDATE
    ========================= */

    const {
      error,
    } = await supabase
      .from(
        "organizations"
      )
      .update({
        name,

        description:
          description ||
          null,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        organizationId
      )
      .eq(
        "owner_id",
        user.id
      );

    if (error) {
      console.error(
        "Update organization error:",
        error
      );

      return;
    }

    revalidatePath(
      `/dashboard/organizations/${organizationId}`
    );

    revalidatePath(
      `/dashboard/organizations/${organizationId}/settings`
    );

    redirect(
      `/dashboard/organizations/${organizationId}/settings?notice=organization-updated`
    );
  }

  /* =========================================================
                        INVITE MEMBER
  ========================================================== */

  async function inviteMember(formData: FormData) {
    "use server";
    const result = await inviteMemberAction(id, {}, formData);
    if (result.error) redirect(`/dashboard/organizations/${id}/settings?inviteError=${encodeURIComponent(result.error)}#members`);
    redirect(`/dashboard/organizations/${id}/settings?notice=invite-sent#members`);
  }

  /* =========================================================
                    UPDATE MEMBER ROLE
  ========================================================== */

  async function updateMemberRole(
    formData: FormData
  ) {
    "use server";

    const supabase =
      await createClient();

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      redirect(
        "/auth/login"
      );
    }

    const organizationId =
      String(
        formData.get(
          "organization_id"
        ) || ""
      );

    const memberId =
      String(
        formData.get(
          "member_id"
        ) || ""
      );

    const role =
      String(
        formData.get(
          "role"
        ) || ""
      );

    if (
      !organizationId ||
      !memberId
    ) {
      return;
    }

    /*
      APENAS ROLES VÁLIDAS
    */

    if (
      role !== "member" &&
      role !== "admin"
    ) {
      return;
    }

    /* =========================
       CONFIRM OWNER
    ========================= */

    const {
      data:
        ownedOrganization,
    } = await supabase
      .from(
        "organizations"
      )
      .select(`
        id,
        owner_id
      `)
      .eq(
        "id",
        organizationId
      )
      .eq(
        "owner_id",
        user.id
      )
      .maybeSingle();

    if (
      !ownedOrganization
    ) {
      return;
    }

    /* =========================
       FIND MEMBER
    ========================= */

    const {
      data:
        member,
      error:
        memberError,
    } = await supabase
      .from(
        "organization_members"
      )
      .select(`
        id,
        user_id
      `)
      .eq(
        "id",
        memberId
      )
      .eq(
        "organization_id",
        organizationId
      )
      .maybeSingle();

    if (
      memberError ||
      !member
    ) {
      console.error(
        "Member lookup error:",
        memberError
      );

      return;
    }

    /*
      OWNER NUNCA PODE
      TER ROLE ALTERADA
      ATRAVÉS DESTE FORM
    */

    if (
      member.user_id ===
      ownedOrganization
        .owner_id
    ) {
      return;
    }

    /* =========================
       UPDATE ROLE
    ========================= */

    const {
      error,
    } = await supabase
      .from(
        "organization_members"
      )
      .update({
        role,
      })
      .eq(
        "id",
        member.id
      )
      .eq(
        "organization_id",
        organizationId
      );

    if (error) {
      console.error(
        "Update member role error:",
        error
      );

      return;
    }

    revalidatePath(
      `/dashboard/organizations/${organizationId}/settings`
    );

    revalidatePath(
      `/dashboard/organizations/${organizationId}`
    );

    revalidatePath(
      "/dashboard/organizations"
    );

    redirect(
      `/dashboard/organizations/${organizationId}/settings?notice=member-updated`
    );
  }

/* =========================================================
                  REMOVE MEMBER
========================================================== */

async function removeMember(
  formData: FormData
) {
  "use server";

  const supabase =
    await createClient();

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/auth/login"
    );
  }

  const organizationId =
    String(
      formData.get(
        "organization_id"
      ) || ""
    );

  const memberId =
    String(
      formData.get(
        "member_id"
      ) || ""
    );

  if (
    !organizationId ||
    !memberId
  ) {
    return;
  }

  /* =========================
     CONFIRM OWNER
  ========================= */

  const {
    data:
      ownedOrganization,
  } = await supabase
    .from(
      "organizations"
    )
    .select(`
      id,
      owner_id
    `)
    .eq(
      "id",
      organizationId
    )
    .eq(
      "owner_id",
      user.id
    )
    .maybeSingle();

  if (
    !ownedOrganization
  ) {
    return;
  }

  /* =========================
     FIND MEMBER
  ========================= */

  const {
    data:
      member,
    error:
      memberLookupError,
  } = await supabase
    .from(
      "organization_members"
    )
    .select(`
      id,
      user_id,
      role
    `)
    .eq(
      "id",
      memberId
    )
    .eq(
      "organization_id",
      organizationId
    )
    .maybeSingle();

  if (
    memberLookupError ||
    !member
  ) {
    console.error(
      "Member lookup error:",
      memberLookupError
    );

    return;
  }

  /*
    OWNER NÃO PODE
    SER REMOVIDO
  */

  if (
    member.user_id ===
    ownedOrganization
      .owner_id
  ) {
    return;
  }

  /* =========================
     DELETE MEMBERSHIP
  ========================= */

  const {
    error,
  } = await supabase
    .from(
      "organization_members"
    )
    .delete()
    .eq(
      "id",
      member.id
    )
    .eq(
      "organization_id",
      organizationId
    );

  if (error) {
    await createAuditLog({
      organizationId,

      action:
        "member.removed",

      targetType:
        "member",

      targetId:
        member.id,

      targetName:
        member.user_id,

      status:
        "failed",

      metadata: {
        userId:
          member.user_id,

        role:
          member.role,

        reason:
          error.message,
      },
    });

    console.error(
      "Remove member error:",
      error
    );

    return;
  }

  /* =========================
     AUDIT LOG
  ========================= */

  await createAuditLog({
    organizationId,

    action:
      "member.removed",

    targetType:
      "member",

    targetId:
      member.id,

    targetName:
      member.user_id,

    status:
      "success",

    metadata: {
      userId:
        member.user_id,

      role:
        member.role,
    },
  });

  revalidatePath(
    `/dashboard/organizations/${organizationId}/settings`
  );

  revalidatePath(
    `/dashboard/organizations/${organizationId}`
  );

  revalidatePath(
    "/dashboard/organizations"
  );

  redirect(
    `/dashboard/organizations/${organizationId}/settings?notice=member-removed`
  );
}

/* =========================================================
                CANCEL PENDING INVITE
========================================================== */

async function cancelPendingInvite(
  formData: FormData
) {
  "use server";

  const supabase =
    await createClient();

  const {
    data: { user },
  } =
    await supabase.auth.getUser();

  if (!user) {
    redirect(
      "/auth/login"
    );
  }

  const organizationId =
    String(
      formData.get(
        "organization_id"
      ) || ""
    );

  const inviteId =
    String(
      formData.get(
        "invite_id"
      ) || ""
    );

  if (
    !organizationId ||
    !inviteId
  ) {
    return;
  }

  /* =========================
     CONFIRM OWNER
  ========================= */

  const {
    data:
      ownedOrganization,
  } = await supabase
    .from(
      "organizations"
    )
    .select("id")
    .eq(
      "id",
      organizationId
    )
    .eq(
      "owner_id",
      user.id
    )
    .maybeSingle();

  if (
    !ownedOrganization
  ) {
    return;
  }

  /* =========================
     GET INVITE
  ========================= */

  const {
    data: invite,
    error: inviteLookupError,
  } = await supabase
    .from(
      "organization_invites"
    )
    .select(`
      id,
      email,
      role,
      status
    `)
    .eq(
      "id",
      inviteId
    )
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "status",
      "pending"
    )
    .maybeSingle();

  if (
    inviteLookupError ||
    !invite
  ) {
    console.error(
      "Invite lookup error:",
      inviteLookupError
    );

    return;
  }

  /* =========================
     DELETE INVITE
  ========================= */

  const {
    error,
  } = await supabase
    .from(
      "organization_invites"
    )
    .delete()
    .eq(
      "id",
      inviteId
    )
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "status",
      "pending"
    );

  if (error) {
    await createAuditLog({
      organizationId,

      action:
        "member.invite_cancelled",

      targetType:
        "invite",

      targetId:
        invite.id,

      targetName:
        invite.email,

      status:
        "failed",

      metadata: {
        role:
          invite.role,

        reason:
          error.message,
      },
    });

    console.error(
      "Cancel invitation error:",
      error
    );

    return;
  }

  /* =========================
     AUDIT LOG
  ========================= */

  await createAuditLog({
    organizationId,

    action:
      "member.invite_cancelled",

    targetType:
      "invite",

    targetId:
      invite.id,

    targetName:
      invite.email,

    status:
      "success",

    metadata: {
      role:
        invite.role,
    },
  });

  revalidatePath(
    `/dashboard/organizations/${organizationId}/settings`
  );

  revalidatePath(
    "/dashboard",
    "layout"
  );

  redirect(
    `/dashboard/organizations/${organizationId}/settings?notice=invite-cancelled`
  );
}

  /* =========================================================
                    DELETE ORGANIZATION
  ========================================================== */

  async function deleteOrganization() {
    "use server";

    const supabase =
      await createClient();

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      redirect(
        "/auth/login"
      );
    }

    const {
      error,
    } = await supabase
      .from(
        "organizations"
      )
      .delete()
      .eq(
        "id",
        id
      )
      .eq(
        "owner_id",
        user.id
      );

    if (error) {
      console.error(
        "Delete organization error:",
        error
      );

      return;
    }

    revalidatePath(
      "/dashboard/organizations"
    );

    redirect(
      "/dashboard/organizations"
    );
  }

  /* =========================================================
                      MEMBER NOTICE
  ========================================================== */

  let memberNotice:
    string | null =
    null;

  if (
    notice ===
    "member-updated"
  ) {
    memberNotice =
      "Member permissions updated successfully.";
  }

  if (
    notice ===
    "member-removed"
  ) {
    memberNotice =
      "Member removed successfully.";
  }

  if (
    notice ===
    "invite-sent"
  ) {
    memberNotice =
      "Invitation sent successfully.";
  }

  if (
    notice ===
    "invite-cancelled"
  ) {
    memberNotice =
      "Invitation cancelled successfully.";
  }

  /* =========================================================
                            PAGE
  ========================================================== */

  return (
    <div className="sg-page">
      <Link href={`/dashboard/organizations/${organization.id}`} className="mb-6 inline-flex items-center gap-2 text-sm text-surface-muted transition hover:text-white">
        <ArrowLeft size={16} />Back to {organization.name}
      </Link>
      <PageHeader title="Organization settings" eyebrow={organization.name} icon={<Settings size={22} />}
        description="Manage organization details, member access and administrative controls." />
      <div className="space-y-6">
        <Surface id="general" className="sg-settings-section overflow-hidden">
          <SectionHeader title="General" description="Basic information about this organization." icon={<Building2 size={17} />} />
          <form action={updateOrganization}>
            <input type="hidden" name="organization_id" value={organization.id} />
            <div className="sg-settings-fields">
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-medium text-zinc-300">Organization name</label>
                <input id="name" name="name" type="text" required defaultValue={organization.name} className="sg-control w-full px-3 py-2.5" />
                <p className="sg-meta mt-2">Displayed across your workspace and client pages.</p>
              </div>
              <div>
                <label htmlFor="description" className="mb-2 block text-sm font-medium text-zinc-300">Description</label>
                <textarea id="description" name="description" rows={4} defaultValue={organization.description ?? ""} placeholder="Organization description..." className="sg-control w-full resize-y px-3 py-2.5" />
              </div>
            </div>
            <div className="flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-t border-surface-edge px-5 py-4">
              <div role="status" className="min-h-5">{notice === "organization-updated" && <SettingsNotice key={notice} message="Organization updated successfully." compact />}</div>
              <FormSubmitButton>Save changes</FormSubmitButton>
            </div>
          </form>
        </Surface>

        <Surface id="members" className="sg-settings-section overflow-hidden">
          <SectionHeader title="Members" description="Manage users and permissions for this organization." icon={<Users size={17} />}
            actions={<InviteMemberButton organizationId={organization.id} action={inviteMember} />} />
          {query.inviteError && <p role="alert" className="p-4 text-sm text-red-400">{query.inviteError}</p>}
          {memberNotice && <SettingsNotice message={memberNotice} />}
          <div className="sg-member-row sg-row">
            <div className="flex min-w-0 items-center gap-3">
              <span className="sg-section-icon"><Crown size={16} className="text-amber-400" /></span>
              <div className="min-w-0"><p className="truncate text-sm font-medium text-white">{ownerDisplayName}</p>
                {ownerDisplayEmail && <p className="mt-1 truncate text-xs text-surface-muted">{ownerDisplayEmail}</p>}
              </div>
            </div>
            <RoleBadge role="owner" />
          </div>
          {membersWithUsers.length === 0 ? (
            <EmptyState title="No additional members yet" description="Invite a teammate to collaborate in this organization." icon={<UserRound size={22} />} />
          ) : membersWithUsers.map((member) => {
            const currentRole = member.role === "admin" ? "admin" : "member";
            return (
              <div key={member.id} className="sg-member-row sg-row">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="sg-section-icon"><UserRound size={16} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{member.display_name}</p>
                    {member.display_email && <p className="mt-1 truncate text-xs text-surface-muted">{member.display_email}</p>}
                    {member.joined_at && <p className="mt-1 text-xs text-surface-muted">Joined {new Date(member.joined_at).toLocaleDateString()}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateMemberRole} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="organization_id" value={organization.id} />
                    <input type="hidden" name="member_id" value={member.id} />
                    <div className="relative">
                      <select name="role" aria-label={`Role for ${member.display_name}`} defaultValue={currentRole} className="sg-control sg-control-sm appearance-none py-2 pl-3 pr-9">
                        <option value="member">Member</option><option value="admin">Admin</option>
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted" />
                    </div>
                    <FormSubmitButton variant="secondary" size="sm" pendingLabel="Updating...">Update</FormSubmitButton>
                  </form>
                  <RemoveMemberButton memberName={member.display_name} memberId={member.id} organizationId={organization.id} action={removeMember} />
                </div>
              </div>
            );
          })}
          {!!invites?.length && <>
            <div className="sg-table-heading border-y border-surface-edge px-5 py-3">Pending invitations</div>
            {invites.map((invite) => (
              <div key={invite.id} className="sg-member-row sg-row">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-200">{invite.email}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-surface-muted">
                    <span>Invited as <span className="capitalize">{invite.role}</span></span>
                    {invite.expires_at && <span>Expires {new Date(invite.expires_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status="pending" />
                  <form action={cancelPendingInvite}>
                    <input type="hidden" name="organization_id" value={organization.id} />
                    <input type="hidden" name="invite_id" value={invite.id} />
                    <FormSubmitButton variant="danger" size="sm" pendingLabel="Cancelling..."><XCircle size={14} />Cancel invitation</FormSubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </>}
        </Surface>

        <Surface id="danger-zone" className="sg-settings-section sg-danger overflow-hidden">
          <SectionHeader title="Danger zone" description="Destructive actions for this organization." icon={<XCircle size={17} />} />
          <div className="flex flex-wrap items-center justify-between gap-5 p-5">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="sg-section-title">Delete organization</h3>
              <p className="sg-section-description max-w-2xl">Permanently delete this organization and all associated clients, sites, devices and monitoring data.</p>
            </div>
            <DeleteOrganizationButton organizationName={organization.name} action={deleteOrganization} />
          </div>
        </Surface>
      </div>
    </div>
  );
}

