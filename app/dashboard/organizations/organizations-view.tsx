"use client";

import Link from "next/link";

import {
  Building2,
  ChevronRight,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  Search,
  Server,
  X,
} from "lucide-react";

import {
  useMemo,
  useState,
} from "react";


type Organization = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};


export default function OrganizationsView({
  organizations,
}: {
  organizations: Organization[];
}) {

  const [search, setSearch] = useState("");

  const [view, setView] =
    useState<"list" | "grid">("list");


  /* =========================================
     SEARCH
  ========================================= */

  const filteredOrganizations = useMemo(() => {

    const query = search
      .trim()
      .toLowerCase();

    if (!query) {
      return organizations;
    }

    return organizations.filter(
      (organization) => {

        const name =
          organization.name.toLowerCase();

        const description =
          organization.description
            ?.toLowerCase() ?? "";

        return (
          name.includes(query) ||
          description.includes(query)
        );
      }
    );

  }, [organizations, search]);


  return (
    <>

      {/* =========================================
          TOOLBAR
      ========================================= */}

      <div
        className="
          mb-6
          flex
          flex-wrap
          items-center
          justify-between
          gap-4
        "
      >

        {/* SEARCH */}

        <div className="relative w-full max-w-md">

          <Search
            size={17}
            className="
              absolute
              left-4
              top-1/2
              -translate-y-1/2
              text-zinc-600
            "
          />

          <input
            type="text"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search organizations..."
            className="
              h-11
              w-full
              rounded-xl
              border
              border-zinc-800
              bg-zinc-900
              pl-11
              pr-11
              text-sm
              text-white
              outline-none
              transition
              placeholder:text-zinc-600
              focus:border-zinc-700
            "
          />


          {search && (

            <button
              type="button"
              onClick={() => setSearch("")}
              className="
                absolute
                right-3
                top-1/2
                flex
                h-7
                w-7
                -translate-y-1/2
                items-center
                justify-center
                rounded-lg
                text-zinc-600
                transition
                hover:bg-zinc-800
                hover:text-white
              "
            >
              <X size={15} />
            </button>

          )}

        </div>


        {/* VIEW MODE */}

        <div
          className="
            flex
            items-center
            rounded-xl
            border
            border-zinc-800
            bg-zinc-900
            p-1
          "
        >

          <button
            type="button"
            onClick={() => setView("list")}
            className={`
              flex
              h-8
              w-9
              items-center
              justify-center
              rounded-lg
              transition

              ${
                view === "list"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-600 hover:text-white"
              }
            `}
            title="List view"
          >
            <List size={16} />
          </button>


          <button
            type="button"
            onClick={() => setView("grid")}
            className={`
              flex
              h-8
              w-9
              items-center
              justify-center
              rounded-lg
              transition

              ${
                view === "grid"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-600 hover:text-white"
              }
            `}
            title="Grid view"
          >
            <LayoutGrid size={16} />
          </button>

        </div>

      </div>


      {/* =========================================
          SEARCH INFO
      ========================================= */}

      {search && (

        <div className="mb-4 text-sm text-zinc-500">

          {filteredOrganizations.length}{" "}
          {filteredOrganizations.length === 1
            ? "organization"
            : "organizations"}{" "}
          found

        </div>

      )}


      {/* =========================================
          EMPTY DATABASE
      ========================================= */}

      {organizations.length === 0 && (

        <div
          className="
            flex
            min-h-[350px]
            flex-col
            items-center
            justify-center
            rounded-2xl
            border
            border-zinc-800
            bg-zinc-900
            text-center
          "
        >

          <div
            className="
              mb-5
              flex
              h-14
              w-14
              items-center
              justify-center
              rounded-2xl
              border
              border-zinc-800
              bg-zinc-950
              text-zinc-500
            "
          >
            <Building2 size={24} />
          </div>

          <h2 className="font-semibold">
            No organizations yet
          </h2>

          <p className="mt-2 max-w-md text-sm text-zinc-500">
            Create your first organization to start
            managing sites, devices and users.
          </p>

        </div>

      )}


      {/* =========================================
          NO SEARCH RESULTS
      ========================================= */}

      {organizations.length > 0 &&
        filteredOrganizations.length === 0 && (

          <div
            className="
              flex
              min-h-[280px]
              flex-col
              items-center
              justify-center
              rounded-2xl
              border
              border-zinc-800
              bg-zinc-900
              text-center
            "
          >

            <Search
              size={25}
              className="mb-4 text-zinc-600"
            />

            <h2 className="font-medium">
              No organizations found
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Try searching for another name.
            </p>

          </div>

        )}


      {/* =========================================
          LIST VIEW
      ========================================= */}

      {filteredOrganizations.length > 0 &&
        view === "list" && (

          <div
            className="
              overflow-hidden
              rounded-2xl
              border
              border-zinc-800
              bg-zinc-900
            "
          >

            {/* HEADER */}

            <div
              className="
                hidden
                grid-cols-[1fr_150px_150px_80px]
                border-b
                border-zinc-800
                px-6
                py-3
                text-xs
                uppercase
                tracking-wide
                text-zinc-600
                md:grid
              "
            >
              <span>
                Organization
              </span>

              <span>
                Sites
              </span>

              <span>
                Devices
              </span>

              <span />
            </div>


            <div className="divide-y divide-zinc-800">

              {filteredOrganizations.map(
                (organization) => (

                  <div
                    key={organization.id}
                    className="
                      group
                      grid
                      items-center
                      gap-4
                      px-6
                      py-5
                      transition
                      hover:bg-zinc-800/40

                      md:grid-cols-[1fr_150px_150px_80px]
                    "
                  >

                    {/* ORGANIZATION */}

                    <Link
                      href={`/dashboard/organizations/${organization.id}`}
                      className="
                        flex
                        min-w-0
                        items-center
                        gap-4
                      "
                    >

                      <div
                        className="
                          flex
                          h-11
                          w-11
                          shrink-0
                          items-center
                          justify-center
                          rounded-xl
                          border
                          border-zinc-800
                          bg-zinc-950
                          text-zinc-400
                        "
                      >
                        <Building2 size={19} />
                      </div>


                      <div className="min-w-0">

                        <p
                          className="
                            truncate
                            font-medium
                            transition
                            group-hover:text-white
                          "
                        >
                          {organization.name}
                        </p>

                        <p
                          className="
                            mt-1
                            truncate
                            text-sm
                            text-zinc-500
                          "
                        >
                          {organization.description ||
                            "No description"}
                        </p>

                      </div>

                    </Link>


                    {/* SITES */}

                    <div className="hidden md:block">

                      <div className="flex items-center gap-2 text-zinc-500">
                        <MapPin size={14} />

                        <span className="text-sm">
                          0
                        </span>
                      </div>

                    </div>


                    {/* DEVICES */}

                    <div className="hidden md:block">

                      <div className="flex items-center gap-2 text-zinc-500">
                        <Server size={14} />

                        <span className="text-sm">
                          0
                        </span>
                      </div>

                    </div>


                    {/* ACTIONS */}

                    <div className="flex justify-end gap-1">

                    <Link
                    href={`/dashboard/organizations/${organization.id}/settings`}
                    className="
                        flex
                        h-9
                        w-9
                        items-center
                        justify-center
                        rounded-lg
                        text-zinc-600
                        transition
                        hover:bg-zinc-800
                        hover:text-white
                    "
                    title="Organization settings"
                    >
                    <Pencil size={15} />
                    </Link>


                      <Link
                        href={`/dashboard/organizations/${organization.id}`}
                        className="
                          flex
                          h-9
                          w-9
                          items-center
                          justify-center
                          rounded-lg
                          text-zinc-600
                          transition
                          hover:bg-zinc-800
                          hover:text-white
                        "
                      >
                        <ChevronRight size={17} />
                      </Link>

                    </div>

                  </div>

                )
              )}

            </div>

          </div>

        )}


      {/* =========================================
          GRID VIEW
      ========================================= */}

      {filteredOrganizations.length > 0 &&
        view === "grid" && (

          <div
            className="
              grid
              gap-4
              md:grid-cols-2
              xl:grid-cols-3
            "
          >

            {filteredOrganizations.map(
              (organization) => (

                <div
                  key={organization.id}
                  className="
                    group
                    rounded-2xl
                    border
                    border-zinc-800
                    bg-zinc-900
                    p-5
                    transition
                    hover:border-zinc-700
                    hover:bg-zinc-900/80
                  "
                >

                  <div className="flex items-start justify-between">

                    <div
                      className="
                        flex
                        h-10
                        w-10
                        items-center
                        justify-center
                        rounded-xl
                        border
                        border-zinc-800
                        bg-zinc-950
                        text-zinc-400
                      "
                    >
                      <Building2 size={18} />
                    </div>


                    <Link
                      href={`/dashboard/organizations/${organization.id}/edit`}
                      className="
                        flex
                        h-8
                        w-8
                        items-center
                        justify-center
                        rounded-lg
                        text-zinc-600
                        transition
                        hover:bg-zinc-800
                        hover:text-white
                      "
                    >
                      <Pencil size={14} />
                    </Link>

                  </div>


                  <Link
                    href={`/dashboard/organizations/${organization.id}`}
                    className="mt-5 block"
                  >

                    <h2 className="font-semibold">
                      {organization.name}
                    </h2>

                    <p className="mt-2 line-clamp-2 min-h-10 text-sm text-zinc-500">
                      {organization.description ||
                        "No description"}
                    </p>

                  </Link>


                  <div
                    className="
                      mt-5
                      flex
                      gap-6
                      border-t
                      border-zinc-800
                      pt-4
                    "
                  >

                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <MapPin size={14} />
                      0 sites
                    </div>

                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                      <Server size={14} />
                      0 devices
                    </div>

                  </div>

                </div>

              )
            )}

          </div>

        )}

    </>
  );
}