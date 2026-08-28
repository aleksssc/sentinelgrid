import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export default async function MonitorsPage() {
  await connection();

  const supabase = await createClient();

  const { data: monitors } = await supabase
    .from("monitors")
    .select("*")
    .order("created_at", { ascending: false });

  async function addMonitor(formData: FormData) {
    "use server";

    const name = formData.get("name") as string;
    const url = formData.get("url") as string;

    if (!name || !url) return;

    const supabase = await createClient();

    const { error } = await supabase.from("monitors").insert({
      name,
      url,
    });

    if (error) {
      console.error(error);
      return;
    }

    revalidatePath("/dashboard/monitors");
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-10">

      <div className="max-w-6xl mx-auto">

        <div className="mb-10">
          <h1 className="text-3xl font-bold">
            Monitors
          </h1>

          <p className="text-zinc-400 mt-2">
            Monitor your websites and services.
          </p>
        </div>


        {/* ADD MONITOR */}

        <form
          action={addMonitor}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-10"
        >

          <h2 className="text-xl font-semibold mb-5">
            Add Monitor
          </h2>

          <div className="flex gap-4">

            <input
              name="name"
              placeholder="Website name"
              required
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 outline-none"
            />

            <input
              name="url"
              type="url"
              placeholder="https://example.com"
              required
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 outline-none"
            />

            <button
              type="submit"
              className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200"
            >
              Add Monitor
            </button>

          </div>

        </form>


        {/* MONITORS */}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

          {monitors?.map((monitor) => (

            <div
              key={monitor.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-6"
            >

              <div className="flex justify-between items-start">

                <div>
                  <h3 className="font-semibold text-lg">
                    {monitor.name}
                  </h3>

                  <p className="text-zinc-500 text-sm mt-1">
                    {monitor.url}
                  </p>
                </div>

                <span className="text-yellow-400 text-sm">
                  ● Not checked
                </span>

              </div>

            </div>

          ))}

        </div>

      </div>

    </main>
  );
}