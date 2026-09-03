"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  Building2,
  ExternalLink,
  Loader2,
  Monitor,
  Search,
  Server,
  X,
} from "lucide-react";

import {
  createClient,
} from "@/lib/supabase/client";

/* =========================
   TYPES
========================= */

type ClientResult = {
  id: string;
  name: string;

  organization_id: string;
};

type DeviceResult = {
  id: string;

  hostname: string;

  display_name:
    | string
    | null;

  local_ip:
    | string
    | null;

  public_ip:
    | string
    | null;

  serial_number:
    | string
    | null;

  model:
    | string
    | null;

  client_id: string;

  clients:
    | {
        id: string;
        name: string;
        organization_id: string;
      }
    | {
        id: string;
        name: string;
        organization_id: string;
      }[]
    | null;
};

type MonitorResult = {
  id: string;

  name: string;

  url: string;

  status:
    | string
    | null;
};

/* =========================
   COMPONENT
========================= */

export default function InfrastructureSearch() {
  const router =
    useRouter();

  const supabase =
    createClient();

  const inputRef =
    useRef<HTMLInputElement>(
      null
    );

  const wrapperRef =
    useRef<HTMLDivElement>(
      null
    );

  const [
    query,
    setQuery,
  ] =
    useState("");

  const [
    open,
    setOpen,
  ] =
    useState(false);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    clients,
    setClients,
  ] =
    useState<
      ClientResult[]
    >([]);

  const [
    devices,
    setDevices,
  ] =
    useState<
      DeviceResult[]
    >([]);

  const [
    monitors,
    setMonitors,
  ] =
    useState<
      MonitorResult[]
    >([]);

  /* =========================
     CTRL / CMD + K
  ========================= */

  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent
    ) {
      if (
        (event.ctrlKey ||
          event.metaKey) &&
        event.key.toLowerCase() ===
          "k"
      ) {
        event.preventDefault();

        inputRef.current?.focus();

        setOpen(
          true
        );
      }

      if (
        event.key ===
        "Escape"
      ) {
        setOpen(
          false
        );

        inputRef.current?.blur();
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, []);

  /* =========================
     CLICK OUTSIDE
  ========================= */

  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent
    ) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(
          false
        );
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
    };
  }, []);

  /* =========================
     SEARCH
  ========================= */

  useEffect(() => {
    const searchQuery =
      query.trim();

    if (
      searchQuery.length <
      2
    ) {
      setClients([]);

      setDevices([]);

      setMonitors([]);

      setLoading(
        false
      );

      return;
    }

    const timeout =
      window.setTimeout(
        async () => {
          setLoading(
            true
          );

          const safeQuery =
            searchQuery.replace(
              /[%_,]/g,
              ""
            );

          /* =========================
             CLIENTS
          ========================= */

          const clientPromise =
            supabase
              .from(
                "clients"
              )
              .select(`
                id,
                name,
                organization_id
              `)
              .ilike(
                "name",
                `%${safeQuery}%`
              )
              .limit(5);

          /* =========================
             DEVICES
          ========================= */

          const devicePromise =
            supabase
              .from(
                "devices"
              )
              .select(`
                id,
                hostname,
                display_name,
                local_ip,
                public_ip,
                serial_number,
                model,
                client_id,

                clients (
                  id,
                  name,
                  organization_id
                )
              `)
              .or(
                [
                  `hostname.ilike.%${safeQuery}%`,
                  `display_name.ilike.%${safeQuery}%`,
                  `local_ip.ilike.%${safeQuery}%`,
                  `public_ip.ilike.%${safeQuery}%`,
                  `serial_number.ilike.%${safeQuery}%`,
                  `model.ilike.%${safeQuery}%`,
                ].join(",")
              )
              .limit(7);

          /* =========================
             MONITORS
          ========================= */

          const monitorPromise =
            supabase
              .from(
                "monitors"
              )
              .select(`
                id,
                name,
                url,
                status
              `)
              .or(
                [
                  `name.ilike.%${safeQuery}%`,
                  `url.ilike.%${safeQuery}%`,
                ].join(",")
              )
              .limit(5);

          const [
            clientResponse,
            deviceResponse,
            monitorResponse,
          ] =
            await Promise.all([
              clientPromise,
              devicePromise,
              monitorPromise,
            ]);

          if (
            clientResponse.error
          ) {
            console.error(
              "Global client search error:",
              clientResponse.error
            );
          }

          if (
            deviceResponse.error
          ) {
            console.error(
              "Global device search error:",
              deviceResponse.error
            );
          }

          if (
            monitorResponse.error
          ) {
            console.error(
              "Global monitor search error:",
              monitorResponse.error
            );
          }

          setClients(
            (clientResponse.data ??
              []) as ClientResult[]
          );

          setDevices(
            (deviceResponse.data ??
              []) as DeviceResult[]
          );

          setMonitors(
            (monitorResponse.data ??
              []) as MonitorResult[]
          );

          setLoading(
            false
          );
        },
        250
      );

    return () => {
      window.clearTimeout(
        timeout
      );
    };
  }, [
    query,
    supabase,
  ]);

  /* =========================
     HELPERS
  ========================= */

  function getDeviceClient(
    device: DeviceResult
  ) {
    if (
      !device.clients
    ) {
      return null;
    }

    if (
      Array.isArray(
        device.clients
      )
    ) {
      return (
        device.clients[0] ??
        null
      );
    }

    return device.clients;
  }

  function navigate(
    href: string
  ) {
    setOpen(
      false
    );

    setQuery("");

    router.push(
      href
    );
  }

  const hasResults =
    clients.length >
      0 ||
    devices.length >
      0 ||
    monitors.length >
      0;

  const searching =
    query.trim().length >=
    2;

  /* =========================
     RENDER
  ========================= */

  return (
    <div
      ref={
        wrapperRef
      }
      className="relative w-full max-w-[360px]"
    >

      {/* =========================
          INPUT
      ========================= */}

      <div
        className={`relative flex h-10 items-center rounded-xl border bg-[#0d0f12] transition ${
          open
            ? "border-zinc-600"
            : "border-zinc-800 hover:border-zinc-700"
        }`}
      >

        <Search
          size={16}
          className="absolute left-3.5 text-zinc-600"
        />

        <input
          ref={
            inputRef
          }
          type="text"
          value={
            query
          }
          onFocus={() =>
            setOpen(
              true
            )
          }
          onChange={(
            event
          ) => {
            setQuery(
              event.target.value
            );

            setOpen(
              true
            );
          }}
          placeholder="Search infrastructure..."
          className="h-full w-full bg-transparent pl-10 pr-16 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
        />

        {loading ? (
          <Loader2
            size={15}
            className="absolute right-3.5 animate-spin text-zinc-600"
          />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");

              inputRef.current?.focus();
            }}
            className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-800 hover:text-white"
          >
            <X
              size={13}
            />
          </button>
        ) : (
          <div className="absolute right-2.5 flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-600">

            <span>
              ⌘
            </span>

            <span>
              K
            </span>

          </div>
        )}

      </div>

      {/* =========================
          RESULTS
      ========================= */}

      {open &&
        searching && (
        <div className="absolute left-0 top-full z-[100] mt-2 w-[440px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-zinc-800 bg-[#0b0d0f] shadow-2xl">

          {/* =========================
              LOADING
          ========================= */}

          {loading && (
            <div className="flex items-center gap-3 px-4 py-5 text-sm text-zinc-500">

              <Loader2
                size={16}
                className="animate-spin"
              />

              Searching infrastructure...

            </div>
          )}

          {/* =========================
              RESULTS
          ========================= */}

          {!loading &&
            hasResults && (
            <div className="max-h-[480px] overflow-y-auto py-2">

              {/* =========================
                  CLIENTS
              ========================= */}

              {clients.length >
                0 && (
                <SearchSection
                  label="Clients"
                >

                  {clients.map(
                    (
                      client
                    ) => (
                      <SearchResultButton
                        key={
                          client.id
                        }
                        icon={
                          <Building2
                            size={16}
                          />
                        }
                        title={
                          client.name
                        }
                        subtitle="Client"
                        onClick={() =>
                          navigate(
                            `/dashboard/organizations/${client.organization_id}/clients/${client.id}`
                          )
                        }
                      />
                    )
                  )}

                </SearchSection>
              )}

              {/* =========================
                  DEVICES
              ========================= */}

              {devices.length >
                0 && (
                <SearchSection
                  label="Devices"
                >

                  {devices.map(
                    (
                      device
                    ) => {
                      const client =
                        getDeviceClient(
                          device
                        );

                      const subtitleParts =
                        [
                          client?.name,
                          device.local_ip,
                          cleanValue(
                            device.model
                          ),
                        ].filter(
                          Boolean
                        );

                      return (
                        <SearchResultButton
                          key={
                            device.id
                          }
                          icon={
                            <Server
                              size={16}
                            />
                          }
                          title={
                            device.display_name ||
                            device.hostname
                          }
                          subtitle={
                            subtitleParts.join(
                              " · "
                            ) ||
                            device.hostname
                          }
                          onClick={() => {
                            if (
                              !client
                            ) {
                              return;
                            }

                            navigate(
                              `/dashboard/organizations/${client.organization_id}/clients/${client.id}?device=${device.id}`
                            );
                          }}
                        />
                      );
                    }
                  )}

                </SearchSection>
              )}

              {/* =========================
                  MONITORS
              ========================= */}

              {monitors.length >
                0 && (
                <SearchSection
                  label="Monitors"
                >

                  {monitors.map(
                    (
                      monitor
                    ) => (
                      <SearchResultButton
                        key={
                          monitor.id
                        }
                        icon={
                          <Monitor
                            size={16}
                          />
                        }
                        title={
                          monitor.name
                        }
                        subtitle={
                          monitor.url
                        }
                        trailing={
                          <ExternalLink
                            size={13}
                          />
                        }
                        onClick={() =>
                          navigate(
                            `/dashboard/monitors?monitor=${monitor.id}`
                          )
                        }
                      />
                    )
                  )}

                </SearchSection>
              )}

            </div>
          )}

          {/* =========================
              EMPTY
          ========================= */}

          {!loading &&
            !hasResults && (
            <div className="px-6 py-10 text-center">

              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600">

                <Search
                  size={18}
                />

              </div>

              <p className="mt-3 text-sm font-medium text-zinc-300">
                No results found
              </p>

              <p className="mt-1 text-xs text-zinc-600">
                No clients, devices or monitors match &quot;{query}&quot;.
              </p>

            </div>
          )}

          {/* =========================
              FOOTER
          ========================= */}

          {!loading &&
            hasResults && (
            <div className="flex items-center justify-between border-t border-zinc-800 bg-[#0d0f12] px-4 py-2.5">

              <span className="text-[10px] text-zinc-600">
                SentinelGrid Infrastructure Search
              </span>

              <span className="text-[10px] text-zinc-700">
                ESC to close
              </span>

            </div>
          )}

        </div>
      )}

    </div>
  );
}

/* =========================
   SEARCH SECTION
========================= */

function SearchSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="py-1">

      <p className="px-4 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </p>

      {
        children
      }

    </div>
  );
}

/* =========================
   SEARCH RESULT
========================= */

function SearchResultButton({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition hover:bg-zinc-900 focus:bg-zinc-900 focus:outline-none"
    >

      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-[#111317] text-zinc-500 transition group-hover:text-zinc-300">

        {icon}

      </div>

      <div className="min-w-0 flex-1">

        <p className="truncate text-sm font-medium text-zinc-200">
          {title}
        </p>

        <p className="mt-0.5 truncate text-xs text-zinc-600">
          {subtitle}
        </p>

      </div>

      {trailing && (
        <span className="shrink-0 text-zinc-700 transition group-hover:text-zinc-400">
          {
            trailing
          }
        </span>
      )}

    </button>
  );
}

/* =========================
   CLEAN INVENTORY VALUE
========================= */

function cleanValue(
  value:
    | string
    | null
) {
  if (!value) {
    return null;
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  const ignored = [
    "to be filled by o.e.m.",
    "to be filled by oem",
    "default string",
    "system product name",
    "unknown",
  ];

  if (
    ignored.includes(
      normalized
    )
  ) {
    return null;
  }

  return value.trim();
}