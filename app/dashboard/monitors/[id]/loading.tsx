export default function MonitorDetailsLoading() {
  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl animate-pulse">

        {/* BACK */}
        <div className="mb-6 h-4 w-32 rounded bg-zinc-900" />

        {/* HEADER */}
        <div className="mb-8">
          <div className="h-9 w-64 rounded-lg bg-zinc-800" />

          <div className="mt-3 h-4 w-80 rounded bg-zinc-900" />
        </div>

        {/* STATS */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-32 rounded-2xl border border-zinc-800 bg-zinc-900"
            />
          ))}

        </div>

        {/* RESPONSE TIME */}
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">

          <div className="h-5 w-32 rounded bg-zinc-800" />

          <div className="mt-3 h-4 w-40 rounded bg-zinc-800/60" />

          <div className="mt-8 h-56 rounded-xl bg-zinc-800/40" />

        </div>

        {/* HISTORY */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

          <div className="border-b border-zinc-800 px-6 py-5">

            <div className="h-5 w-28 rounded bg-zinc-800" />

            <div className="mt-3 h-4 w-48 rounded bg-zinc-800/60" />

          </div>

          <div className="space-y-px">

            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-16 border-b border-zinc-800/70 bg-zinc-900"
              />
            ))}

          </div>

        </div>

      </div>
    </main>
  );
}