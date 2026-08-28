import Link from "next/link";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

import { Plus } from "lucide-react";

import OrganizationsView from "./organizations-view";

export default async function OrganizationsPage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: organizations, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("Organizations error:", error);
  }

  return (
    <main className="p-8">

      <div className="mx-auto max-w-7xl">

        {/* HEADER */}

        <div className="mb-8 flex items-start justify-between gap-6">

          <div>

            <h1 className="text-3xl font-bold">
              Organizations
            </h1>

            <p className="mt-2 text-zinc-400">
              Manage customers, companies and infrastructure environments.
            </p>

          </div>

          <Link
            href="/dashboard/organizations/new"
            className="
              inline-flex
              items-center
              gap-2
              rounded-xl
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
            <Plus size={17} />

            New organization
          </Link>

        </div>


        <OrganizationsView
          organizations={organizations ?? []}
        />

      </div>

    </main>
  );
}