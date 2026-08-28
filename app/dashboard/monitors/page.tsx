import { connection } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function MonitorsPage() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: monitors } = await supabase
    .from("monitors")
    .select("*")
    .order("created_at", { ascending: false });

  async function addMonitor(formData: FormData) {
    "use server";

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const name = String(formData.get("name") ?? "").trim();
    const urlInput = String(formData.get("url") ?? "").trim();

    if (!name || !urlInput) return;

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(urlInput);
    } catch {
      return;
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return;
    }

    await supabase.from("monitors").insert({
      user_id: user.id,
      name,
      url: parsedUrl.toString(),
    });

    revalidatePath("/dashboard/monitors");
  }

  async function checkMonitor(monitorId: string) {
    "use server";

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    /*
      IMPORTANT:
      Só vamos buscar um monitor que pertença
      ao utilizador autenticado.
    */

    const { data: monitor } = await supabase
      .from("monitors")
      .select("*")
      .eq("id", monitorId)
      .eq("user_id", user.id)
      .single();

    if (!monitor) return;

    let online = false;
    let statusCode: number | null = null;
    let responseTime: number | null = null;
    let errorMessage: string | null = null;

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 8000);

    const start = performance.now();

    try {
      const response = await fetch(monitor.url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });

      responseTime = Math.round(
        performance.now() - start
      );

      statusCode = response.status;

      online = response.ok;
    } catch (error) {
      responseTime = Math.round(
        performance.now() - start
      );

      online = false;

      if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = "Unknown connection error";
      }
    } finally {
      clearTimeout(timeout);
    }

    /*
      Guarda histórico
    */

    await supabase.from("monitor_checks").insert({
      monitor_id: monitor.id,
      online,
      status_code: statusCode,
      response_time_ms: responseTime,
      error_message: errorMessage,
    });

    /*
      Atualiza estado atual
    */

    await supabase
      .from("monitors")
      .update({
        status: online ? "online" : "offline",
        status_code: statusCode,
        response_time_ms: responseTime,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", monitor.id);

    revalidatePath("/dashboard/monitors");
    revalidatePath("/dashboard");
  }

  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl">

        {/* HEADER */}

        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            Monitors
          </h1>

          <p className="mt-2 text-zinc-400">
            Monitor websites, APIs and services.
          </p>
        </div>

        {/* ADD MONITOR */}

        <form
          action={addMonitor}
          className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
        >
          <h2 className="mb-5 text-lg font-semibold">
            Add monitor
          </h2>

          <div className="grid gap-4 md:grid-cols-[1fr_2fr_auto]">

            <input
              name="name"
              required
              placeholder="Website name"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none transition focus:border-zinc-500"
            />

            <input
              name="url"
              type="url"
              required
              placeholder="https://example.com"
              className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none transition focus:border-zinc-500"
            />

            <button
              type="submit"
              className="rounded-xl bg-white px-6 py-3 font-medium text-black transition hover:bg-zinc-200"
            >
              Add monitor
            </button>

          </div>
        </form>

        {/* EMPTY STATE */}

        {!monitors?.length && (
          <div className="rounded-2xl border border-dashed border-zinc-800 py-20 text-center">
            <p className="font-medium">
              No monitors yet
            </p>

            <p className="mt-2 text-sm text-zinc-500">
              Add your first website above.
            </p>
          </div>
        )}

        {/* MONITORS */}

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">

          {monitors?.map((monitor) => {
            const checkAction =
              checkMonitor.bind(null, monitor.id);

            return (
              <div
                key={monitor.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
              >

                {/* TOP */}

                <div className="flex items-start justify-between gap-4">

                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold">
                      {monitor.name}
                    </h3>

                    <p className="mt-1 truncate text-sm text-zinc-500">
                      {monitor.url}
                    </p>
                  </div>

                  {monitor.status === "online" && (
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                      ● Online
                    </span>
                  )}

                  {monitor.status === "offline" && (
                    <span className="shrink-0 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
                      ● Offline
                    </span>
                  )}

                  {monitor.status === "unknown" && (
                    <span className="shrink-0 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-400">
                      ● Not checked
                    </span>
                  )}

                </div>

                {/* STATS */}

                <div className="mt-6 grid grid-cols-2 gap-4">

                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-600">
                      Response
                    </p>

                    <p className="mt-1 font-medium">
                      {monitor.response_time_ms
                        ? `${monitor.response_time_ms} ms`
                        : "--"}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-zinc-600">
                      HTTP
                    </p>

                    <p className="mt-1 font-medium">
                      {monitor.status_code ?? "--"}
                    </p>
                  </div>

                </div>

                {/* FOOTER */}

                <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4">

                <span className="text-xs text-zinc-600">
                    {monitor.last_checked_at
                    ? `Last checked ${new Date(
                        monitor.last_checked_at
                        ).toLocaleString()}`
                    : "Never checked"}
                </span>

                <div className="flex items-center gap-2">

                <Link
                    href={`/dashboard/monitors/${monitor.id}`}
                    className="flex h-11 min-w-[110px] items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                >
                    Details
                </Link>

                <form action={checkAction}>
                    <button
                    type="submit"
                    className="flex h-11 min-w-[110px] items-center justify-center whitespace-nowrap rounded-lg border border-zinc-700 px-4 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                    >
                    Check now
                    </button>
                </form>

                </div>

                </div>

              </div>
            );
          })}

        </div>

      </div>
    </main>
  );
}