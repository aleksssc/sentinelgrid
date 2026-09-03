import { redirect } from "next/navigation";
import OnboardingSubmit from "./onboarding-submit";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationContext } from "@/lib/organization-context";

import {
  ArrowRight,
  Building2,
  Check,
  ShieldCheck,
} from "lucide-react";

export default async function OnboardingPage() {
  // =========================
  // CONTEXT
  // =========================

  const {
    user,
    organization,
    ownedOrganization,
  } = await getOrganizationContext();

  // =========================
  // AUTH
  // =========================

  if (!user) {
    redirect("/auth/login");
  }

  // =========================
  // ALREADY CONFIGURED
  // =========================

  if (organization) {
    redirect("/dashboard");
  }

  // =========================
  // COMPLETE ONBOARDING
  // =========================

  async function completeOnboarding(
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

    // =========================
    // NAME
    // =========================

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

    // =========================
    // EXISTING OWNED ORG
    //
    // Ex: Personal
    // =========================

    const {
      data: existingOrganization,
      error: existingOrganizationError,
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

    if (existingOrganizationError) {
      console.error(
        "Onboarding existing organization error:",
        existingOrganizationError
      );

      return;
    }

    let organizationId:
      | string
      | null = null;

    // =========================
    // UPDATE EXISTING
    // =========================

    if (existingOrganization) {
      const {
        error,
      } = await supabase
        .from("organizations")
        .update({
          name,
          setup_completed: true,
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

    // =========================
    // CREATE ORGANIZATION
    // =========================

    else {
      const {
        data,
        error,
      } = await supabase
        .from("organizations")
        .insert({
          name,
          owner_id: user.id,
          setup_completed: true,
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

    // =========================
    // OPEN DASHBOARD
    // =========================

    redirect(
      `/dashboard/organizations/${organizationId}`
    );
  }

  // =========================
  // DEFAULT NAME
  // =========================

  const currentName =
    ownedOrganization?.name &&
    ownedOrganization.name
      .trim()
      .toLowerCase() !==
      "personal"
      ? ownedOrganization.name
      : "";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#09090b] px-6 py-12">

      {/* =========================
          BACKGROUND GRID
      ========================= */}

      <div
        className="
          pointer-events-none
          absolute inset-0
          opacity-[0.32]
          [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)]
          [background-size:52px_52px]
        "
      />

      {/* =========================
          GLOW
      ========================= */}

      <div
        className="
          pointer-events-none
          absolute left-1/2 top-1/2
          h-[500px] w-[500px]
          -translate-x-1/2 -translate-y-1/2
          rounded-full
          bg-cyan-500/[0.035]
          blur-[100px]
        "
      />

      {/* =========================
          CONTENT
      ========================= */}

      <div className="relative z-10 w-full max-w-[470px]">

        {/* LOGO */}

        <div className="mb-8 flex justify-center">

          <div
            className="
              flex h-12 w-12
              items-center justify-center
              rounded-2xl
              border border-white/[0.08]
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

        {/* TITLE */}

        <div className="text-center">

          <p
            className="
              text-xs font-medium
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
              text-3xl font-semibold
              tracking-[-0.03em]
              text-white
            "
          >
            Set up your workspace
          </h1>

          <p
            className="
              mx-auto mt-3
              max-w-sm
              text-sm leading-6
              text-zinc-500
            "
          >
            Give your organization a name.
            You can change it later from your
            account settings.
          </p>

        </div>

        {/* =========================
            CARD
        ========================= */}

        <form
          action={completeOnboarding}
          className="
            mt-8
            overflow-hidden
            rounded-2xl
            border border-white/[0.08]
            bg-[#111113]/90
            shadow-[0_24px_70px_rgba(0,0,0,0.35)]
            backdrop-blur-xl
          "
        >

          <div className="p-6">

            {/* LABEL */}

            <label
              htmlFor="organization_name"
              className="
                text-xs font-medium
                text-zinc-400
              "
            >
              Organization name
            </label>

            {/* INPUT */}

            <div className="relative mt-2">

              <Building2
                size={16}
                className="
                  pointer-events-none
                  absolute left-3.5 top-1/2
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
                  h-11 w-full
                  rounded-xl
                  border border-white/[0.08]
                  bg-black/20

                  pl-10 pr-4

                  text-sm
                  text-white

                  outline-none

                  transition-all duration-200

                  placeholder:text-zinc-700

                  hover:border-white/[0.12]

                  focus:border-white/[0.18]
                  focus:bg-black/30
                  focus:ring-4
                  focus:ring-white/[0.025]
                "
              />

            </div>

            {/* INFO */}

            <div
              className="
                mt-5
                flex items-start gap-3
                rounded-xl
                border border-white/[0.05]
                bg-white/[0.025]
                p-3.5
              "
            >
              <Check
                size={14}
                className="
                  mt-0.5 shrink-0
                  text-emerald-400
                "
              />

              <p
                className="
                  text-xs leading-5
                  text-zinc-500
                "
              >
                Clients, devices, members and billing
                will belong to this organization.
              </p>

            </div>

          </div>

          {/* =========================
              FOOTER
          ========================= */}

          <div
            className="
              flex items-center
              justify-end
              border-t border-white/[0.06]
              bg-black/[0.12]
              px-6 py-4
            "
          >

        <OnboardingSubmit />

          </div>

        </form>

        <p
          className="
            mt-5 text-center
            text-[11px]
            text-zinc-700
          "
        >
          Your workspace can be managed later from Settings.
        </p>

      </div>

    </main>
  );
}