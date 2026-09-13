export default function DashboardLoading() {
  return (
    <div className="sg-page" aria-busy="true" aria-label="Loading dashboard">
      <span role="status" className="sr-only">Loading workspace...</span>
      <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
        <div className="mb-6 space-y-3">
          <div className="h-3 w-36 rounded bg-white/[0.06]" />
          <div className="h-9 w-56 max-w-full rounded-lg bg-white/[0.08]" />
          <div className="h-4 w-80 max-w-full rounded bg-white/[0.05]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="sg-surface p-5">
              <div className="h-3 w-28 rounded bg-white/[0.06]" />
              <div className="mt-5 h-8 w-16 rounded bg-white/[0.08]" />
              <div className="mt-3 h-3 w-36 max-w-full rounded bg-white/[0.05]" />
            </div>
          ))}
        </div>
        <div className="sg-surface mt-6 overflow-hidden">
          <div className="border-b border-surface-edge p-5">
            <div className="h-4 w-36 rounded bg-white/[0.07]" />
            <div className="mt-2 h-3 w-60 max-w-full rounded bg-white/[0.05]" />
          </div>
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="flex items-center gap-4 border-b border-surface-edge px-5 py-4 last:border-0">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.06]" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-40 max-w-full rounded bg-white/[0.07]" />
                <div className="mt-2 h-3 w-56 max-w-full rounded bg-white/[0.05]" />
              </div>
              <div className="h-6 w-16 shrink-0 rounded-full bg-white/[0.06]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
