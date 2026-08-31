export default function DashboardLoading() {
  return (
    <main className="relative min-h-full">
      <div className="mx-auto max-w-[1500px] px-7 py-7 lg:px-9 lg:py-8">

        {/* HEADER */}
        <div className="mb-8">
          <div className="h-3 w-40 animate-pulse rounded bg-white/[0.06]" />

          <div className="mt-4 h-8 w-52 animate-pulse rounded-lg bg-white/[0.08]" />

          <div className="mt-3 h-4 w-80 animate-pulse rounded bg-white/[0.05]" />
        </div>

        {/* CARDS */}
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-white/[0.07] bg-[#111113]/70 p-5"
            >
              <div className="h-3 w-28 animate-pulse rounded bg-white/[0.05]" />

              <div className="mt-5 h-8 w-16 animate-pulse rounded bg-white/[0.08]" />

              <div className="mt-3 h-3 w-36 animate-pulse rounded bg-white/[0.05]" />
            </div>
          ))}
        </div>

        {/* CONTENT */}
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111113]/70">
          <div className="border-b border-white/[0.06] px-5 py-5">
            <div className="h-4 w-36 animate-pulse rounded bg-white/[0.07]" />

            <div className="mt-2 h-3 w-60 animate-pulse rounded bg-white/[0.05]" />
          </div>

          {[0, 1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="flex items-center gap-4 border-b border-white/[0.05] px-5 py-4 last:border-0"
            >
              <div className="h-9 w-9 animate-pulse rounded-xl bg-white/[0.06]" />

              <div className="flex-1">
                <div className="h-4 w-40 animate-pulse rounded bg-white/[0.07]" />

                <div className="mt-2 h-3 w-56 animate-pulse rounded bg-white/[0.05]" />
              </div>

              <div className="h-6 w-20 animate-pulse rounded-full bg-white/[0.06]" />
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}