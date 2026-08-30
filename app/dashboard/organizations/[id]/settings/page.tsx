import Link from "next/link";

import { connection } from "next/server";

import {
  notFound,
  redirect,
} from "next/navigation";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsNotice } from "@/components/organization/settings-notice";
import { RemoveMemberButton } from "@/components/organization/remove-member-button";
import { InviteMemberButton } from "@/components/organization/invite-member-button";
import { DeleteOrganizationButton } from "@/components/organization/delete-organization-button";

import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  Crown,
  Settings,
  ShieldCheck,
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

  async function inviteMember(
    formData: FormData
  ) {
    "use server";

    const supabase =
      await createClient();

    const admin =
      createAdminClient();

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

    const email =
      String(
        formData.get(
          "email"
        ) || ""
      )
        .trim()
        .toLowerCase();

    const role =
      String(
        formData.get(
          "role"
        ) ||
        "member"
      );

    if (!email) {
      return;
    }

    /*
      VIEWER REMOVIDO.

      Apenas:
      - Member
      - Admin
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
      .single();

    if (
      !ownedOrganization
    ) {
      return;
    }

    /* =====================================================
       FIND AUTH USER
    ====================================================== */

    const {
      data:
        authUsersData,
      error:
        authUsersError,
    } =
      await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (
      authUsersError
    ) {
      console.error(
        "Auth users error:",
        authUsersError
      );

      return;
    }

    const existingAuthUser =
      authUsersData.users.find(
        (
          authUser
        ) =>
          authUser.email
            ?.toLowerCase() ===
          email
      );

    /* =========================
       OWNER EMAIL
    ========================= */

    if (
      existingAuthUser
        ?.id ===
      ownedOrganization
        .owner_id
    ) {
      console.error(
        "This user is already the organization owner."
      );

      return;
    }

    /* =========================
       ALREADY MEMBER
    ========================= */

    if (
      existingAuthUser
    ) {
      const {
        data:
          existingMember,
      } = await supabase
        .from(
          "organization_members"
        )
        .select("id")
        .eq(
          "organization_id",
          organizationId
        )
        .eq(
          "user_id",
          existingAuthUser.id
        )
        .maybeSingle();

      if (
        existingMember
      ) {
        console.error(
          "User is already a member."
        );

        return;
      }
    }

    /* =========================
       ALREADY INVITED
    ========================= */

    const {
      data:
        existingInvite,
    } = await supabase
      .from(
        "organization_invites"
      )
      .select("id")
      .eq(
        "organization_id",
        organizationId
      )
      .ilike(
        "email",
        email
      )
      .eq(
        "status",
        "pending"
      )
      .maybeSingle();

    if (
      existingInvite
    ) {
      console.error(
        "User already has a pending invitation."
      );

      return;
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
      error,
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

        invited_user_id:
          existingAuthUser
            ?.id ??
          null,

        status:
          "pending",

        expires_at:
          expiresAt,
      });

    if (error) {
      console.error(
        "Invite member error:",
        error
      );

      return;
    }

    revalidatePath(
      `/dashboard/organizations/${organizationId}/settings`
    );

    revalidatePath(
      "/dashboard",
      "layout"
    );

    redirect(
      `/dashboard/organizations/${organizationId}/settings?notice=invite-sent`
    );
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

    if (!member) {
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
      console.error(
        "Remove member error:",
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

    /*
      APAGA APENAS
      CONVITES AINDA PENDING.

      Como as notificações
      também são baseadas em
      invites pending, desaparece
      automaticamente do sino.
    */

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
      console.error(
        "Cancel invitation error:",
        error
      );

      return;
    }

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
    <main className="p-8">

      <div className="mx-auto max-w-4xl">

        {/* =====================================================
                            BACK
        ====================================================== */}

        <Link
          href={`/dashboard/organizations/${organization.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft
            size={16}
          />

          Back to{" "}
          {
            organization.name
          }
        </Link>

        {/* =====================================================
                            HEADER
        ====================================================== */}

        <div className="mb-8">

          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">

            <Settings
              size={22}
            />

          </div>

          <h1 className="text-3xl font-bold">
            Organization settings
          </h1>

          <p className="mt-2 text-zinc-400">
            Manage settings for{" "}

            <span className="text-zinc-200">
              {
                organization.name
              }
            </span>
            .
          </p>

        </div>

        {/* =====================================================
                            GENERAL
        ====================================================== */}

        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">

          {/* HEADER */}

          <div className="border-b border-zinc-800 px-6 py-5">

            <div className="flex items-center gap-3">

              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10">

                <Building2
                  size={17}
                  className="text-blue-400"
                />

              </div>

              <div>

                <h2 className="font-semibold">
                  General
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Basic information about this organization.
                </p>

              </div>

            </div>

          </div>

          {/* FORM */}

          <form
            action={
              updateOrganization
            }
          >

            <input
              type="hidden"
              name="organization_id"
              value={
                organization.id
              }
            />

            <div className="space-y-6 p-6">

              {/* NAME */}

              <div>

                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-zinc-300"
                >
                  Organization name
                </label>

                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  defaultValue={
                    organization.name
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-blue-500/50"
                />

              </div>

              {/* DESCRIPTION */}

              <div>

                <label
                  htmlFor="description"
                  className="mb-2 block text-sm font-medium text-zinc-300"
                >
                  Description
                </label>

                <textarea
                  id="description"
                  name="description"
                  rows={4}
                  defaultValue={
                    organization.description ??
                    ""
                  }
                  placeholder="Organization description..."
                  className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-blue-500/50"
                />

              </div>

            </div>

            {/* FOOTER */}

              <div className="flex min-h-[74px] flex-wrap items-center justify-between gap-4 border-t border-zinc-800 px-6 py-4">

              {/* SUCCESS */}

              <div className="min-h-5">
                {notice === "organization-updated" && (
                  <SettingsNotice
                    key={notice}
                    message="Organization updated successfully."
                    compact
                  />
                )}
              </div>

              {/* SAVE */}

              <button
                type="submit"
                className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
              >
                Save changes
              </button>

            </div>

          </form>

        </section>

        {/* =====================================================
                            MEMBERS
        ====================================================== */}

        <section className="mt-8 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">

          {/* HEADER */}

          <div className="flex flex-wrap items-center justify-between gap-6 border-b border-zinc-800 px-6 py-5">

            <div className="flex items-center gap-3">

              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">

                <Users
                  size={17}
                  className="text-violet-400"
                />

              </div>

              <div>

                <h2 className="font-semibold">
                  Members
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Manage users and permissions for this organization.
                </p>

              </div>

            </div>

            <InviteMemberButton
              organizationId={
                organization.id
              }
              action={
                inviteMember
              }
            />

          </div>

          {/* ===================================================
                         MEMBER SUCCESS
          ==================================================== */}

          {memberNotice && (
            <SettingsNotice
              message={
                memberNotice
              }
            />
          )}

          {/* ===================================================
                              OWNER
          ==================================================== */}

          <div className="flex items-center justify-between gap-6 border-b border-zinc-800 px-6 py-4">

            <div className="flex min-w-0 items-center gap-3">

              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">

                <Crown
                  size={15}
                  className="text-red-400"
                />

              </div>

              <div className="min-w-0">

                <p className="truncate text-sm font-medium text-white">
                  {
                    ownerDisplayName
                  }
                </p>

                {ownerDisplayEmail && (
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {
                      ownerDisplayEmail
                    }
                  </p>
                )}

              </div>

            </div>

            <RoleBadge
              role="owner"
            />

          </div>

          {/* ===================================================
                        CURRENT MEMBERS
          ==================================================== */}

          {membersWithUsers.length ===
          0 ? (

            <div className="px-6 py-8 text-center">

              <UserRound
                size={20}
                className="mx-auto text-zinc-700"
              />

              <p className="mt-3 text-sm text-zinc-500">
                No additional members yet.
              </p>

            </div>

          ) : (

            membersWithUsers.map(
              (
                member
              ) => {

                /*
                  Se existir algum viewer
                  antigo na BD, mostramos
                  Member para permitir
                  corrigir imediatamente.
                */

                const currentRole =
                  member.role ===
                  "admin"
                    ? "admin"
                    : "member";

                return (
                  <div
                    key={
                      member.id
                    }
                    className="flex flex-wrap items-center justify-between gap-5 border-b border-zinc-800 px-6 py-4 last:border-b-0"
                  >

                    {/* USER */}

                    <div className="flex min-w-0 items-center gap-3">

                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950">

                        <UserRound
                          size={
                            15
                          }
                          className="text-zinc-500"
                        />

                      </div>

                      <div className="min-w-0">

                        <p className="truncate text-sm font-medium text-white">
                          {
                            member.display_name
                          }
                        </p>

                        {member.display_email && (
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {
                              member.display_email
                            }
                          </p>
                        )}

                        {member.joined_at && (
                          <p className="mt-1 text-[11px] text-zinc-600">
                            Joined{" "}

                            {new Date(
                              member.joined_at
                            ).toLocaleDateString()}
                          </p>
                        )}

                      </div>

                    </div>

                    {/* ACTIONS */}

                    <div className="flex flex-wrap items-center justify-end gap-2">

                      {/* ROLE */}

                      <form
                        action={
                          updateMemberRole
                        }
                        className="flex items-center gap-2"
                      >

                        <input
                          type="hidden"
                          name="organization_id"
                          value={
                            organization.id
                          }
                        />

                        <input
                          type="hidden"
                          name="member_id"
                          value={
                            member.id
                          }
                        />

                        <div className="relative">

                          <select
                            name="role"
                            defaultValue={
                              currentRole
                            }
                            className="
                              appearance-none
                              rounded-lg
                              border
                              border-zinc-800
                              bg-zinc-950
                              py-2
                              pl-3
                              pr-9
                              text-xs
                              font-medium
                              text-zinc-300
                              outline-none
                              transition
                              hover:border-zinc-700
                              focus:border-violet-500/50
                              focus:ring-2
                              focus:ring-violet-500/10
                            "
                          >
                            <option value="member">
                              Member
                            </option>

                            <option value="admin">
                              Admin
                            </option>

                          </select>

                          <ChevronDown
                            size={13}
                            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
                          />

                        </div>

                        <button
                          type="submit"
                          className="rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                        >
                          Update
                        </button>

                      </form>

                      {/* REMOVE */}

                      <RemoveMemberButton
                        memberName={
                          member.display_name
                        }
                        memberId={
                          member.id
                        }
                        organizationId={
                          organization.id
                        }
                        action={
                          removeMember
                        }
                      />

                    </div>

                  </div>
                );
              }
            )

          )}

          {/* ===================================================
                        PENDING INVITES
          ==================================================== */}

          {!!invites?.length && (
            <>

              <div className="border-y border-zinc-800 bg-zinc-950/50 px-6 py-3">

                <p className="text-xs font-medium uppercase tracking-wider text-zinc-600">
                  Pending invitations
                </p>

              </div>

              {invites.map(
                (
                  invite
                ) => (
                  <div
                    key={
                      invite.id
                    }
                    className="flex flex-wrap items-center justify-between gap-5 border-b border-zinc-800 px-6 py-4 last:border-b-0"
                  >

                    {/* INVITE INFO */}

                    <div className="min-w-0">

                      <p className="truncate text-sm font-medium text-zinc-300">
                        {
                          invite.email
                        }
                      </p>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600">

                        <span>
                          Invited as{" "}

                          <span className="capitalize">
                            {
                              invite.role
                            }
                          </span>
                        </span>

                        {invite.expires_at && (
                          <>
                            <span className="text-zinc-800">
                              •
                            </span>

                            <span>
                              Expires{" "}

                              {new Date(
                                invite.expires_at
                              ).toLocaleDateString()}
                            </span>
                          </>
                        )}

                      </div>

                    </div>

                    {/* INVITE ACTIONS */}

                    <div className="flex items-center gap-3">

                      <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-400">
                        Pending
                      </span>

                      <form
                        action={
                          cancelPendingInvite
                        }
                      >

                        <input
                          type="hidden"
                          name="organization_id"
                          value={
                            organization.id
                          }
                        />

                        <input
                          type="hidden"
                          name="invite_id"
                          value={
                            invite.id
                          }
                        />

                        <button
                          type="submit"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-xs font-medium text-red-400 transition hover:border-red-500/30 hover:bg-red-500/10"
                        >
                          <XCircle
                            size={
                              14
                            }
                          />

                          Cancel invitation
                        </button>

                      </form>

                    </div>

                  </div>
                )
              )}

            </>
          )}

        </section>

        {/* =====================================================
                        DANGER ZONE
        ====================================================== */}

        <section className="mt-8 overflow-hidden rounded-2xl border border-red-500/20 bg-red-500/[0.025]">

          <div className="border-b border-red-500/10 px-6 py-5">

            <h2 className="font-semibold text-red-400">
              Danger zone
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Destructive actions for this organization.
            </p>

          </div>

          <div className="flex items-center justify-between gap-6 p-6">

            <div>

              <p className="font-medium">
                Delete organization
              </p>

              <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
                Permanently delete this organization and all associated clients, sites, devices and monitoring data.
              </p>

            </div>

            <DeleteOrganizationButton
              organizationName={
                organization.name
              }
              action={
                deleteOrganization
              }
            />

          </div>

        </section>

      </div>

    </main>
  );
}

/* =========================================================
                        ROLE BADGE
========================================================= */

function RoleBadge({
  role,
}: {
  role: string;
}) {
  /* =========================
     OWNER
  ========================= */

  if (
    role === "owner"
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">

        <Crown
          size={12}
        />

        Owner

      </span>
    );
  }

  /* =========================
     ADMIN
  ========================= */

  if (
    role === "admin"
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">

        <ShieldCheck
          size={12}
        />

        Admin

      </span>
    );
  }

  /* =========================
     MEMBER
  ========================= */

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/25 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">

      <ShieldCheck
        size={12}
      />

      Member

    </span>
  );
}