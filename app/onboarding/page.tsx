import { redirect } from "next/navigation";

import OnboardingSubmit from "./onboarding-submit";

import { createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";

import {
  Building2,
  Check,
  Mail,
  ShieldCheck,
  Users,
} from "lucide-react";

export default async function OnboardingPage() {
  // ======================================================
  // CONTEXT
  // ======================================================

  const {
    user,
    organization,
    ownedOrganization,
  } = await getOrganizationContext();

  // ======================================================
  // AUTH
  // ======================================================

  if (!user) {
    redirect("/auth/login");
  }

  // ======================================================
  // ALREADY CONFIGURED
  // ======================================================

  if (organization) {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  // ======================================================
  // CHECK PENDING INVITE
  // ======================================================

  let pendingInvite:
    | {
        id: string;
        organization_id: string;
        email: string;
        role: string | null;
      }
    | null = null;

  if (user.email) {
    const {
      data,
      error,
    } = await supabase
      .from("organization_invites")
      .select(`
        id,
        organization_id,
        email,
        role
      `)
      .ilike(
        "email",
        user.email
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
      )
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(
        "Onboarding pending invite error:",
        error
      );
    }

    pendingInvite = data;
  }

  // ======================================================
  // GET INVITED ORGANIZATION
  // ======================================================

  let invitedOrganization:
    | {
        id: string;
        name: string;
      }
    | null = null;

  if (pendingInvite) {
    const {
      data,
      error,
    } = await supabase
      .from("organizations")
      .select(`
        id,
        name
      `)
      .eq(
        "id",
        pendingInvite.organization_id
      )
      .maybeSingle();

    if (error) {
      console.error(
        "Onboarding invited organization error:",
        error
      );
    }

    invitedOrganization = data;
  }

  // ======================================================
  // DECLINE ORGANIZATION INVITE
  // ======================================================

  async function declineOrganization(
    formData: FormData
  ) {
    "use server";

    const supabase =
      await createClient();

    const {
      data: {
        user,
      },
    } =
      await supabase.auth.getUser();

    if (
      !user ||
      !user.email
    ) {
      redirect("/auth/login");
    }

    // ======================================================
    // INVITE ID
    // ======================================================

    const inviteId =
      String(
        formData.get(
          "invite_id"
        ) || ""
      ).trim();

    if (!inviteId) {
      return;
    }

    // ======================================================
    // REVALIDATE INVITE
    // ======================================================

    const {
      data: invite,
      error: inviteError,
    } = await supabase
      .from("organization_invites")
      .select(`
        id,
        email,
        status
      `)
      .eq(
        "id",
        inviteId
      )
      .ilike(
        "email",
        user.email
      )
      .eq(
        "status",
        "pending"
      )
      .maybeSingle();

    if (
      inviteError ||
      !invite
    ) {
      console.error(
        "Decline organization invite validation error:",
        inviteError
      );

      return;
    }

    // ======================================================
    // DECLINE
    // ======================================================

    const {
      error,
    } = await supabase
      .from("organization_invites")
      .update({
        status: "declined",
      })
      .eq(
        "id",
        invite.id
      )
      .ilike(
        "email",
        user.email
      )
      .eq(
        "status",
        "pending"
      );

    if (error) {
      console.error(
        "Decline organization invite error:",
        error
      );

      return;
    }

    // ======================================================
    // RELOAD ONBOARDING
    //
    // Outro invite -> mostra próximo
    // Sem invites -> Create organization
    // ======================================================

    redirect("/onboarding");
  }

  // ======================================================
  // JOIN ORGANIZATION
  // ======================================================

  async function joinOrganization(
    formData: FormData
  ) {
    "use server";

    const supabase =
      await createClient();

    const {
      data: {
        user,
      },
    } =
      await supabase.auth.getUser();

    if (
      !user ||
      !user.email
    ) {
      redirect("/auth/login");
    }

    // ======================================================
    // INVITE ID
    // ======================================================

    const inviteId =
      String(
        formData.get(
          "invite_id"
        ) || ""
      ).trim();

    if (!inviteId) {
      return;
    }

    // ======================================================
    // REVALIDATE INVITE
    // ======================================================

    const {
      data: invite,
      error: inviteError,
    } = await supabase
      .from("organization_invites")
      .select(`
        id,
        organization_id,
        email,
        role,
        status
      `)
      .eq(
        "id",
        inviteId
      )
      .ilike(
        "email",
        user.email
      )
      .eq(
        "status",
        "pending"
      )
      .maybeSingle();

    if (
      inviteError ||
      !invite
    ) {
      console.error(
        "Join organization invite error:",
        inviteError
      );

      return;
    }

    // ======================================================
    // CHECK EXISTING MEMBERSHIP
    // ======================================================

    const {
      data:
        existingMembership,
      error:
        existingMembershipError,
    } = await supabase
      .from(
        "organization_members"
      )
      .select("id")
      .eq(
        "organization_id",
        invite.organization_id
      )
      .eq(
        "user_id",
        user.id
      )
      .maybeSingle();

    if (
      existingMembershipError
    ) {
      console.error(
        "Existing membership check error:",
        existingMembershipError
      );

      return;
    }

    // ======================================================
    // CREATE MEMBERSHIP
    // ======================================================

    if (!existingMembership) {
      const {
        error:
          membershipError,
      } = await supabase
        .from(
          "organization_members"
        )
        .insert({
          organization_id:
            invite.organization_id,

          user_id:
            user.id,

          role:
            invite.role || "member",
        });

      if (membershipError) {
        console.error(
          "Join organization membership error:",
          membershipError
        );

        return;
      }
    }

    // ======================================================
    // ACCEPT INVITE
    // ======================================================

    const {
      error:
        acceptInviteError,
    } = await supabase
      .from(
        "organization_invites"
      )
      .update({
        status:
          "accepted",
      })
      .eq(
        "id",
        invite.id
      );

    if (
      acceptInviteError
    ) {
      console.error(
        "Accept organization invite error:",
        acceptInviteError
      );

      return;
    }

    // ======================================================
    // OPEN ORGANIZATION
    // ======================================================

    redirect(
      `/dashboard/organizations/${invite.organization_id}`
    );
  }

  // ======================================================
  // CREATE / COMPLETE ORGANIZATION
  // ======================================================

  async function completeOnboarding(
    formData: FormData
  ) {
    "use server";

    const supabase =
      await createClient();

    const {
      data: {
        user,
      },
    } =
      await supabase.auth.getUser();

    if (!user) {
      redirect("/auth/login");
    }

    // ======================================================
    // ORGANIZATION NAME
    // ======================================================

    const name =
      String(
        formData.get(
          "organization_name"
        ) || ""
      ).trim();

    if (
      name.length < 2 ||
      name.length > 80
    ) {
      return;
    }

    // ======================================================
    // EXISTING OWNED ORGANIZATION
    // ======================================================

    const {
      data:
        existingOrganization,
      error:
        existingOrganizationError,
    } = await supabase
      .from("organizations")
      .select(`
        id,
        setup_completed
      `)
      .eq(
        "owner_id",
        user.id
      )
      .limit(1)
      .maybeSingle();

    if (
      existingOrganizationError
    ) {
      console.error(
        "Onboarding existing organization error:",
        existingOrganizationError
      );

      return;
    }

    let organizationId:
      | string
      | null = null;

    // ======================================================
    // UPDATE EXISTING
    // ======================================================

    if (
      existingOrganization
    ) {
      const {
        error,
      } = await supabase
        .from(
          "organizations"
        )
        .update({
          name,

          setup_completed:
            true,

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          existingOrganization.id
        )
        .eq(
          "owner_id",
          user.id
        );

      if (error) {
        console.error(
          "Onboarding update organization error:",
          error
        );

        return;
      }

      organizationId =
        existingOrganization.id;
    }

    // ======================================================
    // CREATE ORGANIZATION
    // ======================================================

    else {
      const {
        data,
        error,
      } = await supabase
        .from(
          "organizations"
        )
        .insert({
          name,

          owner_id:
            user.id,

          setup_completed:
            true,
        })
        .select("id")
        .single();

      if (
        error ||
        !data
      ) {
        console.error(
          "Onboarding create organization error:",
          error
        );

        return;
      }

      organizationId =
        data.id;
    }

    // ======================================================
    // OPEN ORGANIZATION
    // ======================================================

    redirect(
      `/dashboard/organizations/${organizationId}`
    );
  }

  // ======================================================
  // DEFAULT ORGANIZATION NAME
  // ======================================================

  const currentName =
    ownedOrganization?.name &&
    ownedOrganization.name
      .trim()
      .toLowerCase() !==
      "personal"
      ? ownedOrganization.name
      : "";

  // ======================================================
  // INVITE DISPLAY DATA
  // ======================================================

  const inviteOrganizationName =
    invitedOrganization?.name ||
    "Invited organization";

  const inviteRole =
    pendingInvite?.role
      ? pendingInvite.role
          .charAt(0)
          .toUpperCase() +
        pendingInvite.role.slice(1)
      : "Member";

  // ======================================================
  // UI
  // ======================================================

  return (
    <main
      className="
        relative
        flex min-h-screen
        items-center justify-center
        overflow-hidden
        bg-[#09090b]
        px-6 py-8
      "
    >
      {/* ======================================================
          BACKGROUND GRID
      ====================================================== */}

      <div
        className="
          pointer-events-none
          absolute inset-0

          opacity-[0.32]

          [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)]
          [background-size:52px_52px]
        "
      />

      {/* ======================================================
          GLOW
      ====================================================== */}

      <div
        className="
          pointer-events-none

          absolute
          left-1/2
          top-1/2

          h-[500px]
          w-[500px]

          -translate-x-1/2
          -translate-y-1/2

          rounded-full

          bg-cyan-500/[0.035]

          blur-[100px]
        "
      />

      {/* ======================================================
          CONTENT
      ====================================================== */}

      <div
        className="
          relative z-10
          w-full
          max-w-[470px]
        "
      >
        {/* ======================================================
            LOGO
        ====================================================== */}

        <div
          className="
            mb-7
            flex justify-center
          "
        >
          <div
            className="
              flex h-12 w-12
              items-center justify-center

              rounded-2xl

              border
              border-white/[0.08]

              bg-white/[0.035]

              shadow-[0_12px_40px_rgba(0,0,0,0.3)]
            "
          >
            <ShieldCheck
              size={22}
              className="text-zinc-300"
            />
          </div>
        </div>

        {/* ======================================================
            INVITE MODE
        ====================================================== */}

        {pendingInvite ? (
          <>
            {/* ======================================================
                TITLE
            ====================================================== */}

            <div className="text-center">
              <p
                className="
                  text-xs
                  font-medium

                  uppercase
                  tracking-[0.18em]

                  text-zinc-600
                "
              >
                SentinelGrid
              </p>

              <h1
                className="
                  mt-3

                  text-3xl
                  font-semibold

                  tracking-[-0.03em]

                  text-white
                "
              >
                You&apos;ve been invited
              </h1>

              <p
                className="
                  mx-auto mt-3
                  max-w-sm

                  text-sm
                  leading-6

                  text-zinc-500
                "
              >
                You&apos;ve been invited
                to join an organization
                on SentinelGrid.
              </p>
            </div>

            {/* ======================================================
                INVITATION CARD
            ====================================================== */}

            <div
              className="
                mt-7
                overflow-hidden

                rounded-2xl

                border
                border-white/[0.08]

                bg-[#111113]/95

                shadow-[0_24px_70px_rgba(0,0,0,0.35)]

                backdrop-blur-xl
              "
            >
              <div className="p-6">
                {/* ======================================================
                    ORGANIZATION
                ====================================================== */}

                <div
                  className="
                    flex
                    items-center
                    gap-4

                    rounded-xl

                    border
                    border-white/[0.07]

                    bg-black/20

                    p-4

                    transition-all
                    duration-200

                    hover:border-white/[0.1]
                    hover:bg-black/25
                  "
                >
                  {/* ICON */}

                  <div
                    className="
                      flex h-11 w-11
                      shrink-0

                      items-center
                      justify-center

                      rounded-xl

                      border
                      border-white/[0.08]

                      bg-white/[0.04]
                    "
                  >
                    <Building2
                      size={19}
                      className="text-zinc-300"
                    />
                  </div>

                  {/* NAME */}

                  <div
                    className="
                      min-w-0
                      flex-1
                    "
                  >
                    <p
                      className="
                        truncate

                        text-[15px]
                        font-semibold

                        tracking-tight

                        text-zinc-100
                      "
                    >
                      {
                        inviteOrganizationName
                      }
                    </p>

                    <p
                      className="
                        mt-1

                        text-xs

                        text-zinc-500
                      "
                    >
                      SentinelGrid organization
                    </p>
                  </div>
                </div>

                {/* ======================================================
                    INVITE DETAILS
                ====================================================== */}

                <div
                  className="
                    mt-4

                    overflow-hidden

                    rounded-xl

                    border
                    border-white/[0.06]

                    bg-black/[0.12]
                  "
                >
                  {/* EMAIL */}

                  <div
                    className="
                      flex
                      items-center
                      gap-3

                      border-b
                      border-white/[0.05]

                      px-4
                      py-3.5
                    "
                  >
                    <Mail
                      size={14}
                      className="
                        shrink-0
                        text-zinc-500
                      "
                    />

                    <div
                      className="
                        min-w-0
                        flex-1
                      "
                    >
                      <p
                        className="
                          text-[10px]
                          font-medium

                          uppercase
                          tracking-[0.12em]

                          text-zinc-600
                        "
                      >
                        Invited account
                      </p>

                      <p
                        className="
                          mt-1

                          truncate

                          text-xs

                          text-zinc-400
                        "
                      >
                        {
                          user.email
                        }
                      </p>
                    </div>
                  </div>

                  {/* ACCESS LEVEL */}

                  <div
                    className="
                      flex
                      items-center
                      gap-3

                      px-4
                      py-3.5
                    "
                  >
                    <Users
                      size={14}
                      className="
                        shrink-0
                        text-zinc-500
                      "
                    />

                    <div>
                      <p
                        className="
                          text-[10px]
                          font-medium

                          uppercase
                          tracking-[0.12em]

                          text-zinc-600
                        "
                      >
                        Access level
                      </p>

                      <p
                        className="
                          mt-1

                          text-xs

                          text-zinc-400
                        "
                      >
                        {
                          inviteRole
                        }
                      </p>
                    </div>
                  </div>
                </div>

                {/* ======================================================
                    INFO
                ====================================================== */}

                <div
                  className="
                    mt-4

                    flex
                    items-center
                    gap-3

                    rounded-xl

                    border
                    border-emerald-500/[0.10]

                    bg-emerald-500/[0.03]

                    px-4
                    py-3
                  "
                >
                  <Check
                    size={14}
                    className="
                      shrink-0

                      text-emerald-400
                    "
                  />

                  <p
                    className="
                      text-xs
                      leading-5

                      text-zinc-500
                    "
                  >
                    You&apos;ll join{" "}
                    <span
                      className="
                        font-medium
                        text-zinc-400
                      "
                    >
                      {
                        inviteOrganizationName
                      }
                    </span>{" "}
                    as a{" "}
                    <span
                      className="
                        font-medium
                        text-zinc-400
                      "
                    >
                      {inviteRole}
                    </span>
                    .
                  </p>
                </div>
              </div>

              {/* ======================================================
                  FOOTER
              ====================================================== */}

              <div
                className="
                  flex
                  items-center
                  justify-between
                  gap-3

                  border-t
                  border-white/[0.06]

                  bg-black/[0.15]

                  px-6
                  py-4
                "
              >
                {/* ======================================================
                    DECLINE
                ====================================================== */}

                <form
                  action={
                    declineOrganization
                  }
                >
                  <input
                    type="hidden"
                    name="invite_id"
                    value={
                      pendingInvite.id
                    }
                  />

                  <button
                    type="submit"
                    className="
                      inline-flex
                      h-9

                      items-center
                      justify-center

                      rounded-xl

                      border
                      border-white/[0.08]

                      bg-white/[0.025]

                      px-4

                      text-sm
                      font-medium

                      text-zinc-500

                      transition-all
                      duration-200

                      hover:border-white/[0.12]
                      hover:bg-white/[0.055]
                      hover:text-zinc-200

                      active:scale-[0.98]
                    "
                  >
                    Decline
                  </button>
                </form>

                {/* ======================================================
                    JOIN
                ====================================================== */}

                <form
                  action={
                    joinOrganization
                  }
                >
                  <input
                    type="hidden"
                    name="invite_id"
                    value={
                      pendingInvite.id
                    }
                  />

                  <OnboardingSubmit
                    mode="join"
                    organizationName={
                      inviteOrganizationName
                    }
                  />
                </form>
              </div>
            </div>

            {/* ======================================================
                FOOT NOTE
            ====================================================== */}

            <p
              className="
                mt-4

                text-center
                text-[11px]

                text-zinc-700
              "
            >
              This invitation was sent to{" "}
              <span className="text-zinc-600">
                {user.email}
              </span>
              .
            </p>
          </>
        ) : (
          <>
            {/* ======================================================
                CREATE ORGANIZATION MODE
            ====================================================== */}

            {/* ======================================================
                TITLE
            ====================================================== */}

            <div className="text-center">
              <p
                className="
                  text-xs
                  font-medium

                  uppercase
                  tracking-[0.18em]

                  text-zinc-600
                "
              >
                SentinelGrid
              </p>

              <h1
                className="
                  mt-3

                  text-3xl
                  font-semibold

                  tracking-[-0.03em]

                  text-white
                "
              >
                Create your organization
              </h1>

              <p
                className="
                  mx-auto mt-3
                  max-w-sm

                  text-sm
                  leading-6

                  text-zinc-500
                "
              >
                Create your organization
                to start managing clients,
                devices, members and
                monitoring.
              </p>
            </div>

            {/* ======================================================
                CREATE CARD
            ====================================================== */}

            <form
              action={
                completeOnboarding
              }
              className="
                mt-7
                overflow-hidden

                rounded-2xl

                border
                border-white/[0.08]

                bg-[#111113]/95

                shadow-[0_24px_70px_rgba(0,0,0,0.35)]

                backdrop-blur-xl
              "
            >
              <div className="p-6">
                {/* ======================================================
                    LABEL
                ====================================================== */}

                <label
                  htmlFor="organization_name"
                  className="
                    text-xs
                    font-medium

                    text-zinc-400
                  "
                >
                  Organization name
                </label>

                {/* ======================================================
                    INPUT
                ====================================================== */}

                <div className="relative mt-2">
                  <Building2
                    size={16}
                    className="
                      pointer-events-none

                      absolute
                      left-3.5
                      top-1/2

                      -translate-y-1/2

                      text-zinc-600
                    "
                  />

                  <input
                    id="organization_name"
                    name="organization_name"
                    type="text"
                    defaultValue={
                      currentName
                    }
                    placeholder="Acme Corporation"
                    autoFocus
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="organization"
                    className="
                      h-11
                      w-full

                      rounded-xl

                      border
                      border-white/[0.08]

                      bg-black/20

                      pl-10
                      pr-4

                      text-sm

                      text-white

                      outline-none

                      transition-all
                      duration-200

                      placeholder:text-zinc-700

                      hover:border-white/[0.12]

                      focus:border-white/[0.18]
                      focus:bg-black/30

                      focus:ring-4
                      focus:ring-white/[0.025]
                    "
                  />
                </div>

                {/* ======================================================
                    INFO
                ====================================================== */}

                <div
                  className="
                    mt-5

                    flex
                    items-start
                    gap-3

                    rounded-xl

                    border
                    border-white/[0.05]

                    bg-white/[0.025]

                    p-3.5
                  "
                >
                  <Check
                    size={14}
                    className="
                      mt-0.5
                      shrink-0

                      text-emerald-400
                    "
                  />

                  <p
                    className="
                      text-xs
                      leading-5

                      text-zinc-500
                    "
                  >
                    Clients, devices,
                    members and billing
                    will belong to this
                    organization.
                  </p>
                </div>
              </div>

              {/* ======================================================
                  FOOTER
              ====================================================== */}

              <div
                className="
                  flex
                  items-center
                  justify-end

                  border-t
                  border-white/[0.06]

                  bg-black/[0.15]

                  px-6
                  py-4
                "
              >
                <OnboardingSubmit
                  mode="create"
                />
              </div>
            </form>

            {/* ======================================================
                FOOT NOTE
            ====================================================== */}

            <p
              className="
                mt-4

                text-center
                text-[11px]

                text-zinc-700
              "
            >
              Your organization can be
              managed later from Settings.
            </p>
          </>
        )}
      </div>
    </main>
  );
}