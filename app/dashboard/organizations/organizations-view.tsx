"use client";

import Link from "next/link";

import {
  Building2,
  ChevronRight,
  Grid2X2,
  List,
  Monitor,
  Pencil,
  Plus,
  Search,
  Users,
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

/* =========================
   TYPES
========================= */

type Organization = {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;

  clients_count: number;
  devices_count: number;
};

type Props = {
  organizations: Organization[];
};

type ViewMode =
  | "list"
  | "grid";

/* =========================
   COMPONENT
========================= */

export default function OrganizationsView({
  organizations,
}: Props) {
  const [
    search,
    setSearch,
  ] = useState("");

  const [
    viewMode,
    setViewMode,
  ] =
    useState<ViewMode>(
      "list"
    );

  /* =========================
     LOAD VIEW MODE
  ========================= */

  useEffect(() => {
    const stored =
      localStorage.getItem(
        "sentinelgrid-organizations-view"
      );

    if (
      stored === "grid" ||
      stored === "list"
    ) {
      setViewMode(stored);
    }
  }, []);

  /* =========================
     CHANGE VIEW MODE
  ========================= */

  function changeViewMode(
    mode: ViewMode
  ) {
    setViewMode(mode);

    localStorage.setItem(
      "sentinelgrid-organizations-view",
      mode
    );
  }

  /* =========================
     FILTER
  ========================= */

  const filteredOrganizations =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return organizations;
      }

      return organizations.filter(
        (
          organization
        ) => {
          const name =
            organization.name.toLowerCase();

          const description =
            (
              organization.description ??
              ""
            ).toLowerCase();

          return (
            name.includes(
              query
            ) ||
            description.includes(
              query
            )
          );
        }
      );
    }, [
      organizations,
      search,
    ]);

  return (
    <main className="p-8">
      <div className="mx-auto max-w-7xl">

        {/* =========================
            HEADER
        ========================= */}

        <div className="mb-8 flex flex-wrap items-start justify-between gap-6">

          <div>
            <h1 className="text-3xl font-bold">
              Organizations
            </h1>

            <p className="mt-2 text-zinc-500">
              Manage your organizations,
              clients and devices.
            </p>
          </div>

          <Link
            href="/dashboard/organizations/new"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
          >
            <Plus
              size={17}
            />

            New organization
          </Link>

        </div>

        {/* =========================
            TOOLBAR
        ========================= */}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">

          {/* SEARCH */}

          <div className="relative w-full max-w-md">

            <Search
              size={17}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600"
            />

            <input
              type="text"
              value={search}
              onChange={(
                event
              ) =>
                setSearch(
                  event
                    .target
                    .value
                )
              }
              placeholder="Search organizations..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-3 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-600"
            />

          </div>

          {/* VIEW TOGGLE */}

          <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 p-1">

            <button
              type="button"
              onClick={() =>
                changeViewMode(
                  "list"
                )
              }
              title="List view"
              className={`flex h-9 w-10 items-center justify-center rounded-lg transition ${
                viewMode ===
                "list"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <List
                size={17}
              />
            </button>

            <button
              type="button"
              onClick={() =>
                changeViewMode(
                  "grid"
                )
              }
              title="Grid view"
              className={`flex h-9 w-10 items-center justify-center rounded-lg transition ${
                viewMode ===
                "grid"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <Grid2X2
                size={16}
              />
            </button>

          </div>

        </div>

        {/* =========================
            EMPTY
        ========================= */}

        {organizations.length ===
        0 ? (

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-16 text-center">

            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-600">
              <Building2
                size={21}
              />
            </div>

            <h2 className="mt-5 font-semibold">
              No organizations yet
            </h2>

            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
              Create your first
              organization to start
              managing clients and
              devices.
            </p>

            <Link
              href="/dashboard/organizations/new"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
            >
              <Plus
                size={16}
              />

              Create organization
            </Link>

          </section>

        ) : filteredOrganizations.length ===
          0 ? (

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-6 py-14 text-center">

            <Search
              size={21}
              className="mx-auto text-zinc-600"
            />

            <h2 className="mt-4 font-semibold">
              No organizations found
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Try another search.
            </p>

          </section>

        ) : viewMode ===
          "list" ? (

          /* =========================
             LIST VIEW
          ========================= */

          <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">

            {/* HEADER */}

            <div className="grid grid-cols-[1fr_190px_190px_100px] items-center border-b border-zinc-800 px-8 py-4">

              <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600">
                Organization
              </p>

              <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600">
                Clients
              </p>

              <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600">
                Devices
              </p>

              <div />

            </div>

            {/* ROWS */}

            <div className="divide-y divide-zinc-800">

              {filteredOrganizations.map(
                (
                  organization
                ) => (

                  <div
                    key={
                      organization.id
                    }
                    className="group grid grid-cols-[1fr_190px_190px_100px] items-center px-8 py-7 transition hover:bg-zinc-900"
                  >

                    {/* ORGANIZATION */}

                    <Link
                      href={`/dashboard/organizations/${organization.id}`}
                      className="flex min-w-0 items-center gap-5"
                    >

                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-500 transition group-hover:border-zinc-700 group-hover:text-zinc-300">
                        <Building2
                          size={22}
                        />
                      </div>

                      <div className="min-w-0">

                        <p className="truncate text-base font-semibold text-white">
                          {
                            organization.name
                          }
                        </p>

                        <p className="mt-1 truncate text-sm text-zinc-500">
                          {organization.description ||
                            "No description"}
                        </p>

                      </div>

                    </Link>

                    {/* CLIENTS */}

                    <div className="flex items-center gap-3 text-zinc-500">

                      <Users
                        size={17}
                      />

                      <span className="text-sm">
                        {
                          organization.clients_count ??
                          0
                        }
                      </span>

                    </div>

                    {/* DEVICES */}

                    <div className="flex items-center gap-3 text-zinc-500">

                      <Monitor
                        size={17}
                      />

                      <span className="text-sm">
                        {
                          organization.devices_count ??
                          0
                        }
                      </span>

                    </div>

                    {/* ACTIONS */}

                    <div className="flex items-center justify-end gap-1">

                      <Link
                        href={`/dashboard/organizations/${organization.id}/settings`}
                        title="Organization settings"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-800 hover:text-white"
                      >
                        <Pencil
                          size={16}
                        />
                      </Link>

                      <Link
                        href={`/dashboard/organizations/${organization.id}`}
                        title="Open organization"
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-800 hover:text-white"
                      >
                        <ChevronRight
                          size={18}
                        />
                      </Link>

                    </div>

                  </div>

                )
              )}

            </div>

          </section>

        ) : (

          /* =========================
             GRID VIEW
          ========================= */

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">

            {filteredOrganizations.map(
              (
                organization
              ) => (

                <div
                  key={
                    organization.id
                  }
                  className="group overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 transition hover:border-zinc-700 hover:bg-zinc-900"
                >

                  {/* CARD MAIN */}

                  <Link
                    href={`/dashboard/organizations/${organization.id}`}
                    className="block p-6"
                  >

                    <div className="flex items-start justify-between gap-4">

                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-500 transition group-hover:text-zinc-300">
                        <Building2
                          size={20}
                        />
                      </div>

                      <ChevronRight
                        size={18}
                        className="text-zinc-700 transition group-hover:translate-x-0.5 group-hover:text-zinc-400"
                      />

                    </div>

                    <h2 className="mt-5 truncate text-lg font-semibold">
                      {
                        organization.name
                      }
                    </h2>

                    <p className="mt-2 min-h-[40px] line-clamp-2 text-sm leading-5 text-zinc-500">
                      {organization.description ||
                        "No description"}
                    </p>

                  </Link>

                  {/* STATS */}

                  <div className="grid grid-cols-2 border-t border-zinc-800">

                    {/* CLIENTS */}

                    <div className="border-r border-zinc-800 px-5 py-4">

                      <div className="flex items-center gap-2 text-zinc-600">

                        <Users
                          size={15}
                        />

                        <span className="text-xs uppercase tracking-wide">
                          Clients
                        </span>

                      </div>

                      <p className="mt-2 text-lg font-semibold text-zinc-200">
                        {
                          organization.clients_count ??
                          0
                        }
                      </p>

                    </div>

                    {/* DEVICES */}

                    <div className="px-5 py-4">

                      <div className="flex items-center gap-2 text-zinc-600">

                        <Monitor
                          size={15}
                        />

                        <span className="text-xs uppercase tracking-wide">
                          Devices
                        </span>

                      </div>

                      <p className="mt-2 text-lg font-semibold text-zinc-200">
                        {
                          organization.devices_count ??
                          0
                        }
                      </p>

                    </div>

                  </div>

                  {/* FOOTER */}

                  <div className="flex justify-end border-t border-zinc-800 px-4 py-3">

                    <Link
                      href={`/dashboard/organizations/${organization.id}/settings`}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
                    >
                      <Pencil
                        size={14}
                      />

                      Settings
                    </Link>

                  </div>

                </div>

              )
            )}

          </div>

        )}

      </div>
    </main>
  );
}