import { notFound } from "next/navigation";

import {
  Building2,
  Clock3,
  Crown,
  Mail,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  PLAN_LIMITS,
  type PlanName,
} from "@/lib/plans";

import InviteMemberForm from "./invite-member-form";


type MemberRow = {
  user_id: string;
  role: string;
  joined_at: string | null;
};


type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string | null;
};


export default async function MembersPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id: organizationId } =
    await params;

  const supabase =
    await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();


  if (!user) {
    return null;
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
    .eq("id", organizationId)
    .single();


  if (
    organizationError ||
    !organization
  ) {
    notFound();
  }


  const isOwner =
    organization.owner_id === user.id;


  /* =========================
     MEMBERS
  ========================= */

  const {
    data: membersData,
    error: membersError,
  } = await supabase
    .from("organization_members")
    .select(`
      user_id,
      role,
      joined_at
    `)
    .eq(
      "organization_id",
      organizationId
    )
    .order("joined_at", {
      ascending: true,
    });


  if (membersError) {
    console.error(
      "Members error:",
      membersError
    );
  }


  const members =
    (membersData ?? []) as MemberRow[];


  /* =========================
     PENDING INVITES
  ========================= */

  const {
    data: invitesData,
    error: invitesError,
  } = await supabase
    .from("organization_invites")
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
      organizationId
    )
    .eq(
      "status",
      "pending"
    )
    .order("created_at", {
      ascending: false,
    });


  if (invitesError) {
    console.error(
      "Invites error:",
      invitesError
    );
  }


  const pendingInvites =
    (invitesData ?? []) as InviteRow[];


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
     USER DETAILS
  ========================= */

  const userIds =
    Array.from(
      new Set([
        organization.owner_id,

        ...members.map(
          (member) =>
            member.user_id
        ),
      ])
    );


  const admin =
    createAdminClient();


  const authUsers =
    await Promise.all(
      userIds.map(
        async (userId) => {
          const {
            data,
            error,
          } =
            await admin.auth.admin
              .getUserById(userId);


          if (
            error ||
            !data.user
          ) {
            return {
              id: userId,
              email: null,
              name: "Unknown user",
            };
          }


          const authUser =
            data.user;


          const name =
            authUser.user_metadata
              ?.full_name ??
            authUser.user_metadata
              ?.name ??
            authUser.email
              ?.split("@")[0] ??
            "User";


          return {
            id: authUser.id,
            email:
              authUser.email ??
              null,
            name,
          };
        }
      )
    );


  const userMap =
    new Map(
      authUsers.map(
        (authUser) => [
          authUser.id,
          authUser,
        ]
      )
    );


  /* =========================
     SEATS
  ========================= */

  const activeMemberIds =
    new Set([
      organization.owner_id,

      ...members.map(
        (member) =>
          member.user_id
      ),
    ]);


  const activeSeats =
    activeMemberIds.size;


  const usedSeats =
    activeSeats +
    pendingInvites.length;


  const unlimited =
    !Number.isFinite(
      memberLimit
    );


  const canInvite =
    unlimited ||
    usedSeats < memberLimit;


  const ownerUser =
    userMap.get(
      organization.owner_id
    );


  /* =========================
     UI
  ========================= */

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">

      {/* HEADER */}

      <div className="mb-8 flex items-start justify-between">

        <div>

          <div className="mb-3 flex items-center gap-2 text-sm text-zinc-500">
            <Building2 size={15} />

            <span>
              {organization.name}
            </span>

            <span>/</span>

            <span className="text-zinc-300">
              Members
            </span>
          </div>


          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Organization Members
          </h1>


          <p className="mt-2 text-sm text-zinc-500">
            Manage who has access to this organization.
          </p>

        </div>


        <div className="rounded-lg border border-white/10 bg-white/[0.025] px-4 py-3">

          <div className="flex items-center gap-2">

            <Users
              size={15}
              className="text-blue-400"
            />

            <span className="text-sm font-medium text-white">
              {usedSeats}
              {" / "}
              {unlimited
                ? "Unlimited"
                : memberLimit}
            </span>

          </div>

          <span className="mt-1 block text-xs capitalize text-zinc-500">
            {plan} plan
          </span>

        </div>

      </div>


      {/* GRID */}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">

        {/* LEFT */}

        <div className="space-y-6">

          {/* ACTIVE MEMBERS */}

          <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">

            <div className="border-b border-white/10 px-5 py-4">

              <div className="flex items-center gap-2">

                <Users
                  size={16}
                  className="text-zinc-400"
                />

                <h2 className="font-medium text-white">
                  Members
                </h2>

              </div>

              <p className="mt-1 text-xs text-zinc-500">
                Users with access to this organization.
              </p>

            </div>


            {/* OWNER */}

            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">

              <div className="flex items-center gap-3">

                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-yellow-500/20 bg-yellow-500/10">
                  <Crown
                    size={17}
                    className="text-yellow-400"
                  />
                </div>


                <div>

                  <div className="flex items-center gap-2">

                    <span className="text-sm font-medium text-white">
                      {ownerUser?.name ??
                        "Organization Owner"}
                    </span>

                    {organization.owner_id ===
                      user.id && (
                      <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">
                        You
                      </span>
                    )}

                  </div>


                  <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">

                    <Mail size={12} />

                    {ownerUser?.email ??
                      "No email"}

                  </div>

                </div>

              </div>


              <div className="flex items-center gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-1 text-xs font-medium text-yellow-400">
                <Crown size={12} />
                Owner
              </div>

            </div>


            {/* MEMBERS */}

            {members
              .filter(
                (member) =>
                  member.user_id !==
                  organization.owner_id
              )
              .map(
                (member) => {
                  const memberUser =
                    userMap.get(
                      member.user_id
                    );


                  return (
                    <div
                      key={
                        member.user_id
                      }
                      className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 last:border-b-0"
                    >

                      <div className="flex items-center gap-3">

                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.035]">
                          <UserRound
                            size={17}
                            className="text-zinc-400"
                          />
                        </div>


                        <div>

                          <div className="flex items-center gap-2">

                            <span className="text-sm font-medium text-white">
                              {memberUser?.name ??
                                "Member"}
                            </span>


                            {member.user_id ===
                              user.id && (
                              <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500">
                                You
                              </span>
                            )}

                          </div>


                          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">

                            <Mail size={12} />

                            {memberUser?.email ??
                              "No email"}

                          </div>

                        </div>

                      </div>


                      <div className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs font-medium capitalize text-blue-400">

                        <ShieldCheck
                          size={12}
                        />

                        {member.role}

                      </div>

                    </div>
                  );
                }
              )}

          </section>


          {/* PENDING */}

          {isOwner && (
            <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">

              <div className="border-b border-white/10 px-5 py-4">

                <div className="flex items-center gap-2">

                  <Clock3
                    size={16}
                    className="text-zinc-400"
                  />

                  <h2 className="font-medium text-white">
                    Pending Invitations
                  </h2>

                </div>

                <p className="mt-1 text-xs text-zinc-500">
                  Invitations waiting to be accepted.
                </p>

              </div>


              {pendingInvites.length ===
              0 ? (

                <div className="px-5 py-8 text-center">

                  <p className="text-sm text-zinc-500">
                    No pending invitations.
                  </p>

                </div>

              ) : (

                pendingInvites.map(
                  (invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 last:border-b-0"
                    >

                      <div>

                        <div className="flex items-center gap-2">

                          <span className="text-sm font-medium text-white">
                            {invite.email}
                          </span>

                        </div>

                        <span className="mt-1 block text-xs capitalize text-zinc-500">
                          {invite.role}
                        </span>

                      </div>


                      <span className="rounded-md border border-orange-500/20 bg-orange-500/10 px-2.5 py-1 text-xs font-medium text-orange-400">
                        Pending
                      </span>

                    </div>
                  )
                )

              )}

            </section>
          )}

        </div>


        {/* RIGHT */}

        <aside>

          {isOwner ? (

            <div className="sticky top-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">

              <h2 className="font-medium text-white">
                Invite Member
              </h2>

              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Invite someone to access{" "}
                {organization.name}.
              </p>


              <div className="mt-5">

                <InviteMemberForm
                  organizationId={
                    organizationId
                  }
                  disabled={
                    !canInvite
                  }
                  disabledReason={
                    !canInvite
                      ? `Your ${plan} plan has reached its member limit.`
                      : undefined
                  }
                />

              </div>

            </div>

          ) : (

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">

              <ShieldCheck
                size={18}
                className="mb-3 text-blue-400"
              />

              <h2 className="text-sm font-medium text-white">
                Organization Member
              </h2>

              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Only the organization owner can invite or manage team members.
              </p>

            </div>

          )}

        </aside>

      </div>

    </div>
  );
}