import Link from "next/link";

import { connection } from "next/server";

import {
  notFound,
  redirect,
} from "next/navigation";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import {
  ArrowLeft,
  Building2,
  Settings,
  Users,
} from "lucide-react";

import { InviteMemberButton } from "@/components/invite-member-button";
import { DeleteOrganizationButton } from "@/components/delete-organization-button";


export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;

  const supabase = await createClient();


  /* =========================================================
                          USER
  ========================================================== */

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();


  if (
    organizationError ||
    !organization
  ) {
    notFound();
  }


  /* =========================================================
                          MEMBERS
  ========================================================== */

  const {
    data: members,
    error: membersError,
  } = await supabase
    .from("organization_members")
    .select("*")
    .eq(
      "organization_id",
      organization.id
    )
    .order("joined_at", {
      ascending: true,
    });


  if (membersError) {
    console.error(
      "Organization members error:",
      membersError
    );
  }


  /* =========================================================
                      PENDING INVITES
  ========================================================== */

  const {
    data: invites,
    error: invitesError,
  } = await supabase
    .from("organization_invites")
    .select("*")
    .eq(
      "organization_id",
      organization.id
    )
    .eq("status", "pending")
    .order("created_at", {
      ascending: false,
    });


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
    } = await supabase.auth.getUser();


    if (!user) {
      redirect("/auth/login");
    }


    const organizationId = String(
      formData.get(
        "organization_id"
      ) || ""
    );


    const name = String(
      formData.get("name") || ""
    ).trim();


    const description = String(
      formData.get(
        "description"
      ) || ""
    ).trim();


    if (!name) {
      return;
    }


    /* CONFIRM OWNER */

    const {
      data: ownedOrganization,
    } = await supabase
      .from("organizations")
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


    if (!ownedOrganization) {
      return;
    }


    /* CHECK DUPLICATE NAME */

    const {
      data: duplicateOrganization,
    } = await supabase
      .from("organizations")
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


    if (duplicateOrganization) {
      console.error(
        "Another organization with this name already exists."
      );

      return;
    }


    /* UPDATE */

    const { error } = await supabase
      .from("organizations")
      .update({
        name,
        description:
          description || null,

        updated_at:
          new Date().toISOString(),
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
      `/dashboard/organizations/${organizationId}/settings`
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


    const {
      data: { user },
    } = await supabase.auth.getUser();


    if (!user) {
      redirect("/auth/login");
    }


    const organizationId = String(
      formData.get(
        "organization_id"
      ) || ""
    );


    const email = String(
      formData.get("email") || ""
    )
      .trim()
      .toLowerCase();


    const role = String(
      formData.get("role") ||
      "member"
    );


    if (!email) {
      return;
    }


    if (
      role !== "member" &&
      role !== "admin"
    ) {
      return;
    }


    /* CONFIRM OWNER */

    const {
      data: ownedOrganization,
    } = await supabase
      .from("organizations")
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


    if (!ownedOrganization) {
      return;
    }


    /* ALREADY MEMBER */

    const {
      data: existingMember,
    } = await supabase
      .from("organization_members")
      .select("id")
      .eq(
        "organization_id",
        organizationId
      )
      .ilike(
        "email",
        email
      )
      .maybeSingle();


    if (existingMember) {
      console.error(
        "User is already a member."
      );

      return;
    }


    /* ALREADY INVITED */

    const {
      data: existingInvite,
    } = await supabase
      .from("organization_invites")
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


    if (existingInvite) {
      console.error(
        "User already has a pending invitation."
      );

      return;
    }


    /* CREATE INVITE */

    const { error } = await supabase
      .from("organization_invites")
      .insert({
        organization_id:
          organizationId,

        email,

        role,

        invited_by:
          user.id,
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


    redirect(
      `/dashboard/organizations/${organizationId}/settings`
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
    } = await supabase.auth.getUser();


    if (!user) {
      redirect("/auth/login");
    }


    const { error } = await supabase
      .from("organizations")
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
          className="
            mb-6
            inline-flex
            items-center
            gap-2
            text-sm
            text-zinc-500
            transition
            hover:text-white
          "
        >
          <ArrowLeft size={16} />

          Back to {organization.name}
        </Link>


        {/* =====================================================
                            HEADER
        ====================================================== */}

        <div className="mb-8">

          <div
            className="
              mb-5
              flex
              h-12
              w-12
              items-center
              justify-center
              rounded-xl
              border
              border-zinc-800
              bg-zinc-900
              text-zinc-400
            "
          >
            <Settings size={22} />
          </div>


          <h1 className="text-3xl font-bold">
            Organization settings
          </h1>


          <p className="mt-2 text-zinc-400">
            Manage settings for{" "}

            <span className="text-zinc-200">
              {organization.name}
            </span>.
          </p>

        </div>


        {/* =====================================================
                            GENERAL
        ====================================================== */}

        <section
          className="
            overflow-hidden
            rounded-2xl
            border
            border-zinc-800
            bg-zinc-900
          "
        >

          <div className="border-b border-zinc-800 px-6 py-5">

            <div className="flex items-center gap-3">

              <Building2
                size={18}
                className="text-zinc-500"
              />


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
                  className="mb-2 block text-sm font-medium"
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
                  className="
                    w-full
                    rounded-xl
                    border
                    border-zinc-800
                    bg-zinc-950
                    px-4
                    py-3
                    text-sm
                    text-white
                    outline-none
                    transition
                    focus:border-zinc-600
                  "
                />

              </div>


              {/* DESCRIPTION */}

              <div>

                <label
                  htmlFor="description"
                  className="mb-2 block text-sm font-medium"
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
                  className="
                    w-full
                    resize-none
                    rounded-xl
                    border
                    border-zinc-800
                    bg-zinc-950
                    px-4
                    py-3
                    text-sm
                    text-white
                    outline-none
                    transition
                    placeholder:text-zinc-700
                    focus:border-zinc-600
                  "
                />

              </div>

            </div>


            <div
              className="
                flex
                justify-end
                border-t
                border-zinc-800
                px-6
                py-4
              "
            >

              <button
                type="submit"
                className="
                  rounded-lg
                  bg-white
                  px-4
                  py-2.5
                  text-sm
                  font-medium
                  text-black
                  transition
                  hover:bg-zinc-200
                "
              >
                Save changes
              </button>

            </div>

          </form>

        </section>


        {/* =====================================================
                            MEMBERS
        ====================================================== */}

        <section
          className="
            mt-8
            overflow-hidden
            rounded-2xl
            border
            border-zinc-800
            bg-zinc-900
          "
        >

          {/* HEADER */}

          <div
            className="
              flex
              items-center
              justify-between
              gap-6
              border-b
              border-zinc-800
              px-6
              py-5
            "
          >

            <div className="flex items-center gap-3">

              <Users
                size={18}
                className="text-zinc-500"
              />


              <div>

                <h2 className="font-semibold">
                  Members
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Manage users with access to this organization.
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


          {/* CURRENT MEMBERS */}

          <div>

            {!members?.length ? (

              <div className="px-6 py-10 text-center text-sm text-zinc-500">
                No members found.
              </div>

            ) : (

              members.map(
                (member) => (

                  <div
                    key={
                      member.id
                    }
                    className="
                      flex
                      items-center
                      justify-between
                      gap-6
                      border-b
                      border-zinc-800
                      px-6
                      py-4
                      last:border-b-0
                    "
                  >

                    <div className="min-w-0">

                      <p className="truncate text-sm font-medium">
                        {member.email ||
                          "Unknown user"}
                      </p>


                      <p className="mt-1 text-xs text-zinc-600">
                        Joined{" "}

                        {new Date(
                          member.joined_at
                        ).toLocaleDateString()}
                      </p>

                    </div>


                    <RoleBadge
                      role={
                        member.role
                      }
                    />

                  </div>

                )
              )

            )}

          </div>


          {/* ===================================================
                        PENDING INVITES
          ==================================================== */}

          {!!invites?.length && (
            <>

              <div
                className="
                  border-y
                  border-zinc-800
                  bg-zinc-950/40
                  px-6
                  py-3
                "
              >

                <p
                  className="
                    text-xs
                    font-medium
                    uppercase
                    tracking-wider
                    text-zinc-600
                  "
                >
                  Pending invitations
                </p>

              </div>


              {invites.map(
                (invite) => (

                  <div
                    key={
                      invite.id
                    }
                    className="
                      flex
                      items-center
                      justify-between
                      gap-6
                      border-b
                      border-zinc-800
                      px-6
                      py-4
                      last:border-b-0
                    "
                  >

                    <div className="min-w-0">

                      <p className="truncate text-sm font-medium text-zinc-300">
                        {invite.email}
                      </p>


                      <p className="mt-1 text-xs text-zinc-600">
                        Invited as{" "}
                        {invite.role}
                      </p>

                    </div>


                    <span
                      className="
                        rounded-full
                        bg-yellow-500/10
                        px-3
                        py-1
                        text-xs
                        font-medium
                        text-yellow-400
                      "
                    >
                      Pending
                    </span>

                  </div>

                )
              )}

            </>
          )}

        </section>


        {/* =====================================================
                        DANGER ZONE
        ====================================================== */}

        <section
          className="
            mt-8
            overflow-hidden
            rounded-2xl
            border
            border-red-500/20
            bg-red-500/[0.02]
          "
        >

          <div
            className="
              border-b
              border-red-500/10
              px-6
              py-5
            "
          >

            <h2 className="font-semibold text-red-400">
              Danger zone
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Destructive actions for this organization.
            </p>

          </div>


          <div
            className="
              flex
              items-center
              justify-between
              gap-6
              p-6
            "
          >

            <div>

              <p className="font-medium">
                Delete organization
              </p>


              <p
                className="
                  mt-1
                  max-w-xl
                  text-sm
                  leading-6
                  text-zinc-500
                "
              >
                Permanently delete this organization and all associated
                sites, devices and monitoring data.
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
  if (role === "owner") {
    return (
      <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
        Owner
      </span>
    );
  }


  if (role === "admin") {
    return (
      <span className="rounded-full bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-400">
        Admin
      </span>
    );
  }


  return (
    <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-400">
      Member
    </span>
  );
}