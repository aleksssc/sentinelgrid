"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import {
  Building2,
  ChevronRight,
  LayoutGrid,
  List,
  Search,
} from "lucide-react";

type Client = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
};

type Props = {
  organizationId: string;
  clients: Client[];
};

type ViewMode = "grid" | "list";

const STORAGE_KEY =
  "sentinelgrid-organization-clients-view";

export default function OrganizationClients({
  organizationId,
  clients,
}: Props) {
  const [search, setSearch] = useState("");

  const [viewMode, setViewMode] =
    useState<ViewMode>("grid");

  const [mounted, setMounted] =
    useState(false);

  /* =========================
     LOAD SAVED VIEW
  ========================= */

  useEffect(() => {
    const savedView =
      localStorage.getItem(STORAGE_KEY);

    if (
      savedView === "grid" ||
      savedView === "list"
    ) {
      setViewMode(savedView);
    }

    setMounted(true);
  }, []);

  /* =========================
     CHANGE VIEW
  ========================= */

  function changeView(
    view: ViewMode
  ) {
    setViewMode(view);

    localStorage.setItem(
      STORAGE_KEY,
      view
    );
  }

  /* =========================
     SEARCH
  ========================= */

  const filteredClients =
    useMemo(() => {
      const value = search
        .trim()
        .toLowerCase();

      if (!value) {
        return clients;
      }

      return clients.filter(
        (client) => {
          const nameMatch =
            client.name
              .toLowerCase()
              .includes(value);

          const descriptionMatch =
            client.description
              ?.toLowerCase()
              .includes(value);

          return (
            nameMatch ||
            descriptionMatch
          );
        }
      );
    }, [clients, search]);

  /* evita diferença entre SSR/client */

  if (!mounted) {
    return (
      <div className="h-40 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40" />
    );
  }

  return (
    <div>

      {/* =========================
          TOOLBAR
      ========================= */}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">

        {/* SEARCH */}

        <div className="relative w-full max-w-md">

          <Search
            size={17}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
          />

          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-600"
          />

        </div>

        {/* RIGHT ACTIONS */}

        <div className="flex items-center gap-3">

          {/* VIEW TOGGLE */}

          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 p-1">

            <button
              type="button"
              onClick={() =>
                changeView("grid")
              }
              title="Grid view"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                viewMode === "grid"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <LayoutGrid
                size={16}
              />
            </button>

            <button
              type="button"
              onClick={() =>
                changeView("list")
              }
              title="List view"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                viewMode === "list"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <List size={16} />
            </button>

          </div>

        </div>

      </div>

      {/* =========================
          EMPTY SEARCH
      ========================= */}

      {filteredClients.length ===
      0 ? (

        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-12 text-center">

          <Building2
            size={24}
            className="mx-auto text-zinc-600"
          />

          <h3 className="mt-4 font-medium">
            No clients found
          </h3>

          <p className="mt-2 text-sm text-zinc-500">
            Try searching for
            another client.
          </p>

        </div>

      ) : viewMode ===
        "grid" ? (

        /* =========================
            GRID VIEW
        ========================= */

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">

          {filteredClients.map(
            (client) => (

              <Link
                key={client.id}
                href={`/dashboard/organizations/${organizationId}/clients/${client.id}`}
                className="group flex min-h-56 flex-col rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition hover:border-zinc-700 hover:bg-zinc-800/60"
              >

                {/* TOP */}

                <div className="flex items-start justify-between gap-4">

                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400">
                    <Building2
                      size={19}
                    />
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      client.status ===
                      "active"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {client.status ===
                    "active"
                      ? "Active"
                      : "Inactive"}
                  </span>

                </div>

                {/* CONTENT */}

                <div className="mt-6 flex-1">

                  <h3 className="truncate text-base font-semibold">
                    {
                      client.name
                    }
                  </h3>

                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-500">
                    {client.description ||
                      "No description provided."}
                  </p>

                </div>

                {/* FOOTER */}

                <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4">

                  <span className="text-xs text-zinc-600 transition group-hover:text-zinc-400">
                    Open client
                  </span>

                  <ChevronRight
                    size={17}
                    className="text-zinc-600 transition group-hover:translate-x-1 group-hover:text-white"
                  />

                </div>

              </Link>

            )
          )}

        </div>

      ) : (

        /* =========================
            LIST VIEW
        ========================= */

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">

          <div className="divide-y divide-zinc-800">

            {filteredClients.map(
              (client) => (

                <Link
                  key={client.id}
                  href={`/dashboard/organizations/${organizationId}/clients/${client.id}`}
                  className="group flex items-center justify-between gap-6 px-5 py-4 transition hover:bg-zinc-800/50"
                >

                  {/* LEFT */}

                  <div className="flex min-w-0 items-center gap-4">

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400">
                      <Building2
                        size={18}
                      />
                    </div>

                    <div className="min-w-0">

                      <p className="truncate text-sm font-medium text-zinc-100">
                        {
                          client.name
                        }
                      </p>

                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {client.description ||
                          "No description provided."}
                      </p>

                    </div>

                  </div>

                  {/* RIGHT */}

                  <div className="flex shrink-0 items-center gap-5">

                    <span
                      className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                        client.status ===
                        "active"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {client.status ===
                      "active"
                        ? "Active"
                        : "Inactive"}
                    </span>

                    <ChevronRight
                      size={17}
                      className="text-zinc-700 transition group-hover:translate-x-1 group-hover:text-zinc-400"
                    />

                  </div>

                </Link>

              )
            )}

          </div>

        </div>

      )}

    </div>
  );
}