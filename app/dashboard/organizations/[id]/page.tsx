import Link from "next/link";

import { connection } from "next/server";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  ArrowLeft,
  Building2,
  MapPin,
  Plus,
  Server,
  ChevronRight,
  Settings,
} from "lucide-react";

export default async function OrganizationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  const { id } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;


  /* ORGANIZATION */

  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (!organization) {
    notFound();
  }


  /* SITES */

  const { data: sites, error } = await supabase
    .from("sites")
    .select("*")
    .eq("organization_id", organization.id)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error("Organization sites error:", error);
  }

  const siteList = sites ?? [];


  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl">

        {/* BACK */}

        <Link
          href="/dashboard/organizations"
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft size={16} />

          Back to organizations
        </Link>


        {/* HEADER */}

        <div className="mb-8 flex flex-wrap items-start justify-between gap-6">

          <div className="flex items-start gap-4">

            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">
              <Building2 size={22} />
            </div>

            <div>

              <h1 className="text-3xl font-bold">
                {organization.name}
              </h1>

              <p className="mt-2 max-w-2xl text-zinc-400">
                {organization.description ||
                  "No description provided."}
              </p>

            </div>

          </div>


            <div className="flex items-center gap-3">

            {organization.owner_id === user.id && (
                <Link
                href={`/dashboard/organizations/${organization.id}/settings`}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                >
                <Settings size={17} />
                Settings
                </Link>
            )}

            <Link
                href={`/dashboard/organizations/${organization.id}/sites/new`}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
            >
                <Plus size={17} />
                Add site
            </Link>

            </div>

        </div>


        {/* STATS */}

        <div className="mb-8 grid gap-4 md:grid-cols-3">

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

            <p className="text-sm text-zinc-400">
              Sites
            </p>

            <p className="mt-3 text-3xl font-bold">
              {siteList.length}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              infrastructure locations
            </p>

          </div>


          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

            <p className="text-sm text-zinc-400">
              Devices
            </p>

            <p className="mt-3 text-3xl font-bold">
              0
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              registered agents
            </p>

          </div>


          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

            <p className="text-sm text-zinc-400">
              Online
            </p>

            <p className="mt-3 text-3xl font-bold">
              0
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              active devices
            </p>

          </div>

        </div>


        {/* SITES */}

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

          <div className="border-b border-zinc-800 px-6 py-5">

            <h2 className="font-semibold">
              Sites
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Locations and environments inside this organization.
            </p>

          </div>


          {siteList.length === 0 ? (

            <div className="flex flex-col items-center px-6 py-16 text-center">

              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-500">
                <MapPin size={21} />
              </div>

              <h3 className="font-semibold">
                No sites configured
              </h3>

              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
                Create a site to start deploying SentinelGrid agents
                into this organization.
              </p>

              <Link
                href={`/dashboard/organizations/${organization.id}/sites/new`}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black"
              >
                <Plus size={16} />

                Create first site
              </Link>

            </div>

          ) : (

            <div className="divide-y divide-zinc-800">

              {siteList.map((site) => (

                <Link
                  key={site.id}
                  href={`/dashboard/organizations/${organization.id}/sites/${site.id}`}
                  className="group flex items-center justify-between gap-6 px-6 py-5 transition hover:bg-zinc-800/40"
                >

                  <div className="flex min-w-0 items-center gap-4">

                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400">
                      <MapPin size={19} />
                    </div>


                    <div className="min-w-0">

                      <p className="truncate font-medium">
                        {site.name}
                      </p>

                      <p className="mt-1 truncate text-sm text-zinc-500">
                        {site.location ||
                          "No location specified"}
                      </p>

                    </div>

                  </div>


                  <div className="flex items-center gap-8">

                    <div className="hidden text-right sm:block">

                      <div className="flex items-center gap-2 text-zinc-500">
                        <Server size={14} />

                        <span className="text-sm">
                          0 devices
                        </span>
                      </div>

                    </div>

                    <ChevronRight
                      size={18}
                      className="text-zinc-700 transition group-hover:translate-x-1 group-hover:text-zinc-400"
                    />

                  </div>

                </Link>

              ))}

            </div>

          )}

        </div>

      </div>
    </main>
  );
}