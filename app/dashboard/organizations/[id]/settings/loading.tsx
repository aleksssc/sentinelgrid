export default function OrganizationsLoading() {
  return (
    <main className="p-8">

      <div className="mx-auto max-w-7xl animate-pulse">

        <div className="mb-8">

          <div className="h-8 w-52 rounded-lg bg-zinc-800" />

          <div className="mt-3 h-4 w-96 rounded bg-zinc-900" />

        </div>


        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">

          {Array.from({ length: 6 }).map((_, index) => (

            <div
              key={index}
              className="
                h-64
                rounded-2xl
                border
                border-zinc-800
                bg-zinc-900
              "
            />

          ))}

        </div>

      </div>

    </main>
  );
}