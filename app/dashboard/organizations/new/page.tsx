import Link from "next/link";

import { connection } from "next/server";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { OrganizationSubmitButton } from "@/components/organization-submit-button";

import {
  ArrowLeft,
  Building2,
} from "lucide-react";

export default async function NewOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
  }>;
}) {
  await connection();

  const { error } = await searchParams;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }


  /* =========================================================
                        CREATE ORGANIZATION
  ========================================================== */

  async function createOrganization(formData: FormData) {
    "use server";

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/auth/login");
    }


    const name = String(
      formData.get("name") || ""
    ).trim();

    const description = String(
      formData.get("description") || ""
    ).trim();


    /* VALIDATION */

    if (!name) {
      redirect(
        "/dashboard/organizations/new?error=name_required"
      );
    }


    /* CHECK IF ORGANIZATION ALREADY EXISTS */

    const {
      data: existingOrganization,
      error: existingOrganizationError,
    } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", user.id)
      .ilike("name", name)
      .maybeSingle();


    if (existingOrganizationError) {
      console.error(
        "Check organization error:",
        existingOrganizationError
      );

      redirect(
        "/dashboard/organizations/new?error=unknown"
      );
    }


    if (existingOrganization) {
      redirect(
        "/dashboard/organizations/new?error=organization_exists"
      );
    }


    /* CREATE ORGANIZATION */

    const {
      data: organization,
      error: createError,
    } = await supabase
      .from("organizations")
      .insert({
        owner_id: user.id,
        name,
        description: description || null,
      })
      .select("id")
      .single();


    if (createError) {
      console.error(
        "Create organization error:",
        createError
      );


      /*
        Safety net caso exista também
        unique constraint na base de dados.
      */

      if (createError.code === "23505") {
        redirect(
          "/dashboard/organizations/new?error=organization_exists"
        );
      }


      redirect(
        "/dashboard/organizations/new?error=unknown"
      );
    }


    /* SUCCESS */

    redirect(
      `/dashboard/organizations/${organization.id}`
    );
  }


  return (
    <main className="p-8">

      <div className="mx-auto max-w-3xl">

        {/* =========================================================
                              BACK
        ========================================================== */}

        <Link
          href="/dashboard/organizations"
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

          Back to organizations
        </Link>


        {/* =========================================================
                              HEADER
        ========================================================== */}

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
            <Building2 size={22} />
          </div>


          <h1 className="text-3xl font-bold">
            New organization
          </h1>


          <p className="mt-2 text-zinc-400">
            Create a customer, company or infrastructure environment.
          </p>

        </div>


        {/* =========================================================
                              FORM
        ========================================================== */}

        <form
          action={createOrganization}
          className="
            overflow-hidden
            rounded-2xl
            border
            border-zinc-800
            bg-zinc-900
          "
        >

          <div className="space-y-6 p-6">

            {/* =====================================================
                                NAME
            ====================================================== */}

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
                autoComplete="off"
                placeholder="Example Company"
                className={`
                  w-full
                  rounded-xl
                  border
                  bg-zinc-950
                  px-4
                  py-3
                  text-sm
                  text-white
                  outline-none
                  transition
                  placeholder:text-zinc-700

                  ${
                    error === "organization_exists" ||
                    error === "name_required"
                      ? "border-red-500/60 focus:border-red-500"
                      : "border-zinc-800 focus:border-zinc-600"
                  }
                `}
              />


              {error === "organization_exists" && (
                <p className="mt-2 text-sm text-red-400">
                  An organization with this name already exists.
                </p>
              )}


              {error === "name_required" && (
                <p className="mt-2 text-sm text-red-400">
                  Organization name is required.
                </p>
              )}

            </div>


            {/* =====================================================
                              DESCRIPTION
            ====================================================== */}

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
                placeholder="Production infrastructure, customer environment..."
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


            {/* =====================================================
                              GENERIC ERROR
            ====================================================== */}

            {error === "unknown" && (

              <div
                className="
                  rounded-xl
                  border
                  border-red-500/20
                  bg-red-500/5
                  px-4
                  py-3
                  text-sm
                  text-red-400
                "
              >
                Something went wrong while creating the organization.
                Please try again.
              </div>

            )}

          </div>


          {/* =========================================================
                              ACTIONS
          ========================================================== */}

          <div
            className="
              flex
              items-center
              justify-end
              gap-3
              border-t
              border-zinc-800
              px-6
              py-4
            "
          >

            <Link
              href="/dashboard/organizations"
              className="
                rounded-lg
                px-4
                py-2.5
                text-sm
                text-zinc-400
                transition
                hover:text-white
              "
            >
              Cancel
            </Link>


            <OrganizationSubmitButton />

          </div>

        </form>

      </div>

    </main>
  );
}