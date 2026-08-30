"use server";

import {
  revalidatePath,
} from "next/cache";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

import {
  PLAN_LIMITS,
  type PlanName,
} from "@/lib/plans";


export type InviteMemberState = {
  error?: string;
  success?: string;
};


export async function inviteMemberAction(
  organizationId: string,
  _previousState: InviteMemberState,
  formData: FormData
): Promise<InviteMemberState> {
  const email =
    String(
      formData.get("email") ??
        ""
    )
      .trim()
      .toLowerCase();


  const role =
    String(
      formData.get("role") ??
        "member"
    );


  if (!email) {
    return {
      error:
        "Email is required.",
    };
  }


  if (
    role !== "member" &&
    role !== "admin"
  ) {
    return {
      error:
        "Invalid role.",
    };
  }


  const supabase =
    await createClient();


  const {
    data: { user },
  } =
    await supabase.auth.getUser();


  if (!user) {
    return {
      error:
        "You must be signed in.",
    };
  }


  /* =========================
     ORGANIZATION
  ========================= */

  const {
    data: organization,
    error: organizationError,
  } = await supabase
    .from("organizations")
    .select(`
      id,
      name,
      owner_id
    `)
    .eq(
      "id",
      organizationId
    )
    .single();


  if (
    organizationError ||
    !organization
  ) {
    return {
      error:
        "Organization not found.",
    };
  }


  if (
    organization.owner_id !==
    user.id
  ) {
    return {
      error:
        "Only the organization owner can invite members.",
    };
  }


  /* =========================
     SUBSCRIPTION
  ========================= */

  const {
    data: subscription,
  } = await supabase
    .from(
      "organization_subscriptions"
    )
    .select("plan")
    .eq(
      "organization_id",
      organizationId
    )
    .maybeSingle();


  const plan =
    (
      subscription?.plan ??
      "free"
    ) as PlanName;


  const memberLimit =
    PLAN_LIMITS[plan]?.members ??
    1;


  /* =========================
     MEMBERS
  ========================= */

  const {
    data: members,
  } = await supabase
    .from(
      "organization_members"
    )
    .select("user_id")
    .eq(
      "organization_id",
      organizationId
    );


  const activeIds =
    new Set([
      organization.owner_id,

      ...(members ?? []).map(
        (member) =>
          member.user_id
      ),
    ]);


  /* =========================
     EXPIRE OLD INVITES
  ========================= */

  const now =
    new Date().toISOString();


  await supabase
    .from(
      "organization_invites"
    )
    .update({
      status: "expired",
    })
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "status",
      "pending"
    )
    .lt(
      "expires_at",
      now
    );


  /* =========================
     PENDING INVITES
  ========================= */

  const {
    count: pendingCount,
  } = await supabase
    .from(
      "organization_invites"
    )
    .select(
      "id",
      {
        head: true,
        count: "exact",
      }
    )
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "status",
      "pending"
    )
    .gt(
      "expires_at",
      now
    );


  const usedSeats =
    activeIds.size +
    (pendingCount ?? 0);


  if (
    Number.isFinite(
      memberLimit
    ) &&
    usedSeats >= memberLimit
  ) {
    return {
      error:
        `Your ${plan} plan supports up to ${memberLimit} team members.`,
    };
  }


  /* =========================
     DUPLICATE INVITE
  ========================= */

  const {
    data: existingInvite,
  } = await supabase
    .from(
      "organization_invites"
    )
    .select("id")
    .eq(
      "organization_id",
      organizationId
    )
    .eq(
      "email",
      email
    )
    .eq(
      "status",
      "pending"
    )
    .maybeSingle();


  if (existingInvite) {
    return {
      error:
        "This email already has a pending invitation.",
    };
  }


  /* =========================
     AUTH USER
  ========================= */

  const admin =
    createAdminClient();


  const {
    data: usersData,
    error: usersError,
  } =
    await admin.auth.admin
      .listUsers({
        page: 1,
        perPage: 1000,
      });


  if (usersError) {
    return {
      error:
        "Unable to check existing users.",
    };
  }


  const existingUser =
    usersData.users.find(
      (authUser) =>
        authUser.email
          ?.toLowerCase() ===
        email
    );


  /* =========================
     ALREADY MEMBER
  ========================= */

  if (existingUser) {
    if (
      existingUser.id ===
      organization.owner_id
    ) {
      return {
        error:
          "This user is already the organization owner.",
      };
    }


    if (
      activeIds.has(
        existingUser.id
      )
    ) {
      return {
        error:
          "This user is already a member of the organization.",
      };
    }
  }


  /* =========================
     CREATE INVITE
  ========================= */

  const expiresAt =
    new Date(
      Date.now() +
        7 *
          24 *
          60 *
          60 *
          1000
    ).toISOString();


  const {
    data: invitation,
    error: invitationError,
  } = await supabase
    .from(
      "organization_invites"
    )
    .insert({
      organization_id:
        organizationId,

      email,

      role,

      invited_by:
        user.id,

      status:
        "pending",

      expires_at:
        expiresAt,
    })
    .select(`
      id,
      token
    `)
    .single();


  if (
    invitationError ||
    !invitation
  ) {
    console.error(
      "Invitation error:",
      invitationError
    );


    return {
      error:
        invitationError
          ?.message ??
        "Unable to create invitation.",
    };
  }


  /* =========================
     EXISTING USER
  ========================= */

  if (existingUser) {
    await supabase
      .from(
        "organization_invites"
      )
      .update({
        invited_user_id:
          existingUser.id,
      })
      .eq(
        "id",
        invitation.id
      );


    revalidatePath(
      `/dashboard/organizations/${organizationId}/members`
    );


    return {
      success:
        `${email} has been invited.`,
    };
  }


  /* =========================
     NEW USER
  ========================= */

  const siteUrl =
    process.env
      .NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";


  const {
    data: invitedUser,
    error: inviteError,
  } =
    await admin.auth.admin
      .inviteUserByEmail(
        email,
        {
          redirectTo:
            `${siteUrl}/auth/invite`,

          data: {
            organization_invite_token:
              invitation.token,

            organization_id:
              organizationId,

            organization_name:
              organization.name,

            organization_role:
              role,
          },
        }
      );


  if (inviteError) {
    await supabase
      .from(
        "organization_invites"
      )
      .delete()
      .eq(
        "id",
        invitation.id
      );


    return {
      error:
        inviteError.message,
    };
  }


  if (
    invitedUser.user?.id
  ) {
    await supabase
      .from(
        "organization_invites"
      )
      .update({
        invited_user_id:
          invitedUser.user.id,
      })
      .eq(
        "id",
        invitation.id
      );
  }


  revalidatePath(
    `/dashboard/organizations/${organizationId}/members`
  );


  return {
    success:
      `Invitation sent to ${email}.`,
  };
}