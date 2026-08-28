export default function DashboardPage() {
  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>

        <p className="mt-2 text-zinc-400">
          Overview of your infrastructure.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-sm text-zinc-400">Online</p>
          <p className="mt-2 text-3xl font-bold">0</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-sm text-zinc-400">Warnings</p>
          <p className="mt-2 text-3xl font-bold">0</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-sm text-zinc-400">Offline</p>
          <p className="mt-2 text-3xl font-bold">0</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-sm text-zinc-400">Uptime</p>
          <p className="mt-2 text-3xl font-bold">--</p>
        </div>
      </div>
    </main>
  );
}