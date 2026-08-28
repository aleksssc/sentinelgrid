export default function DashboardLoading() {
  return (
    <main className="p-8">
      <div className="animate-pulse">
        <div className="mb-3 h-8 w-48 rounded-lg bg-zinc-800" />
        <div className="mb-8 h-4 w-72 rounded bg-zinc-900" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-32 rounded-2xl border border-zinc-800 bg-zinc-900"
            />
          ))}
        </div>
      </div>
    </main>
  );
}