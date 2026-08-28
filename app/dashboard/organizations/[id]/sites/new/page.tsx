import Link from "next/link";

import { redirect, notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import {
  ArrowLeft,
  MapPin,
} from "lucide-react";

export default async function NewSitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: organizationId } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }


  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .eq("owner_id", user.id)
    .single();

  if (!organization) {
    notFound();
  }


  async function createSite(formData: FormData) {
    "use server";

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect("/auth/login");
    }

    const organizationId = String(
      formData.get("organization_id")
    );

    const name = String(
      formData.get("name") || ""
    ).trim();

    const location = String(
      formData.get("location") || ""
    ).trim();

    const description = String(
      formData.get("description") || ""
    ).trim();


    if (!name) {
      return;
    }


    const { error } = await supabase
      .from("sites")
      .insert({
        organization_id: organizationId,
        name,
        location: location || null,
        description: description || null,
      });

    if (error) {
      console.error("Create site error:", error);
      return;
    }


    redirect(
      `/dashboard/organizations/${organizationId}`
    );
  }


  return (
    <main className="p-8">

      <div className="mx-auto max-w-3xl">

        <Link
          href={`/dashboard/organizations/${organization.id}`}
          className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-white"
        >
          <ArrowLeft size={16} />

          Back to {organization.name}
        </Link>


        <div className="mb-8">

          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400">
            <MapPin size={22} />
          </div>

          <h1 className="text-3xl font-bold">
            New site
          </h1>

          <p className="mt-2 text-zinc-400">
            Add an infrastructure location to {organization.name}.
          </p>

        </div>


        <form
          action={createSite}
          className="rounded-2xl border border-zinc-800 bg-zinc-900"
        >

          <input
            type="hidden"
            name="organization_id"
            value={organization.id}
          />


          <div className="space-y-6 p-6">

            <div>

              <label className="mb-2 block text-sm font-medium">
                Site name
              </label>

              <input
                name="name"
                required
                placeholder="Lisbon Office"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-700 focus:border-zinc-600"
              />

            </div>


            <div>

              <label className="mb-2 block text-sm font-medium">
                Location
              </label>

              <input
                name="location"
                placeholder="Lisbon, Portugal"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-700 focus:border-zinc-600"
              />

            </div>


            <div>

              <label className="mb-2 block text-sm font-medium">
                Description
              </label>

              <textarea
                name="description"
                rows={4}
                placeholder="Main office infrastructure..."
                className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-700 focus:border-zinc-600"
              />

            </div>

          </div>


          <div className="flex justify-end border-t border-zinc-800 px-6 py-4">

            <button
              type="submit"
              className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
            >
              Create site
            </button>

          </div>

        </form>

      </div>

    </main>
  );
}