import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const moduleURL = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const compile = (path) =>
  ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

const policyURL = moduleURL(
  compile("../lib/remote/rdp-policy.ts"),
);

const policy = await import(policyURL);

let source = compile("../lib/remote/rdp.ts")
  .replace(
    'import "server-only";',
    "",
  );

source = source
  .replace(
    'import { createClient } from "@/lib/supabase/server";',
    "const createClient = async () => globalThis.__rdpTest.client;",
  )
  .replace(
    'import { createAdminClient } from "@/lib/supabase/admin";',
    "const createAdminClient = () => globalThis.__rdpTest.admin;",
  )
  .replace(
    'import { agentCommandChannel, publishRealtimeMessage } from "@/lib/realtime/pubsub";',
    `
const agentCommandChannel = (id) => id;
const publishRealtimeMessage = async (channel, payload) => {
  globalThis.__rdpTest.notifications.push({
    channel,
    payload,
  });
};
`,
  )
  .replace(
    'import { getRedis } from "@/lib/realtime/redis";',
    "const getRedis = () => globalThis.__rdpTest.redis;",
  )
  .replace(
    'import { enforceRemoteRateLimit } from "@/lib/remote/rate-limit";',
    "const enforceRemoteRateLimit = async () => {};",
  )
  .replace(
    'import { UpdateAPIError } from "@/lib/agent/update-auth";',
    "class UpdateAPIError extends Error {}",
  )
  .replace(
    'from "./rdp-policy"',
    `from ${JSON.stringify(policyURL)}`,
  );

const rdp =
  await import(
    moduleURL(source)
  );

const device =
  "40000000-0000-4000-8000-000000000001";

const session =
  "50000000-0000-4000-8000-000000000001";

function setup(
  t,
  overrides = {},
) {
  const oldRelay =
    process.env
      .SENTINELGRID_RELAY_URL;

  const oldSecret =
    process.env
      .SENTINELGRID_RDP_RELAY_SECRET;

  process.env
    .SENTINELGRID_RELAY_URL =
    "wss://relay.example/rdp";

  process.env
    .SENTINELGRID_RDP_RELAY_SECRET =
    "a".repeat(64);

  const values =
    new Map();

  const records = {
    devices: {
      id: device,
      client_id: "client",
      last_seen:
        new Date()
          .toISOString(),
      capabilities: {
        rdp: true,
        tcp_tunnel: true,
      },
    },

    clients: {
      organization_id: "org",
    },

    organizations: {
      owner_id: "user",
    },

    organization_members:
      null,

    organization_remote_access_settings: {
      remote_access_enabled:
        true,
      rdp_enabled:
        true,
      max_session_minutes:
        30,
      max_concurrent_sessions:
        2,
      idle_timeout_minutes:
        15,
    },

    rdp_sessions: {
      id: session,
      organization_id:
        "org",
      device_id:
        device,
      requested_by:
        "user",
      status:
        "requested",
      created_at:
        new Date()
          .toISOString(),
      expires_at:
        new Date(
          Date.now() +
            60_000,
        ).toISOString(),
    },

    ...overrides,
  };

  const state = {
    records,

    calls: [],

    notifications: [],

    client: {
      auth: {
        getUser:
          async () => ({
            data: {
              user: {
                id: "user",
              },
            },
          }),
      },
    },

    admin: {
      from(table) {
        const result =
          () =>
            Promise.resolve({
              data:
                records[
                  table
                ],

              error:
                null,
            });

        const query = {
          select:
            () =>
              query,

          eq:
            () =>
              query,

          single:
            result,

          maybeSingle:
            result,
        };

        return query;
      },

      async rpc(
        name,
        args,
      ) {
        state.calls.push({
          name,
          args,
        });

        return {
          data:
            session,

          error:
            null,
        };
      },
    },

    redis: {
      async set(
        key,
        value,
        options,
      ) {
        assert.equal(
          options.ex,
          60,
        );

        assert.equal(
          options.nx,
          true,
        );

        values.set(
          key,
          value,
        );

        return "OK";
      },

      async getdel(
        key,
      ) {
        const value =
          values.get(
            key,
          );

        values.delete(
          key,
        );

        return value;
      },
    },
  };

  globalThis.__rdpTest =
    state;

  t.after(() => {
    delete globalThis
      .__rdpTest;

    if (
      oldRelay ===
      undefined
    ) {
      delete process.env
        .SENTINELGRID_RELAY_URL;
    } else {
      process.env
        .SENTINELGRID_RELAY_URL =
        oldRelay;
    }

    if (
      oldSecret ===
      undefined
    ) {
      delete process.env
        .SENTINELGRID_RDP_RELAY_SECRET;
    } else {
      process.env
        .SENTINELGRID_RDP_RELAY_SECRET =
        oldSecret;
    }
  });

  return state;
}

test(
  "RDP policy rejects insecure relay URLs, stale/future inventory and invalid limits",
  () => {
    for (
      const value of [
        undefined,
        "ws://relay.example/rdp",
        "wss://u:p@relay.example/rdp",
        "wss://relay.example/rdp?token=x",
        "wss://relay.example/other",
      ]
    ) {
      assert.throws(
        () =>
          policy.relayURL(
            value,
          ),
      );
    }

    assert.equal(
      policy.rdpOnline(
        "invalid",
      ),
      false,
    );

    assert.equal(
      policy.rdpOnline(
        new Date(
          Date.now() +
            60_000,
        ).toISOString(),
      ),
      false,
    );

    assert.equal(
      policy.rdpOnline(
        new Date(
          Date.now() -
            100_000,
        ).toISOString(),
      ),
      false,
    );

    for (
      const limits of [
        {
          max_session_minutes:
            0,

          max_concurrent_sessions:
            2,
        },

        {
          max_session_minutes:
            30,

          max_concurrent_sessions:
            21,
        },
      ]
    ) {
      assert.throws(
        () =>
          policy.rdpLimits(
            limits,
          ),
      );
    }
  },
);

test(
  "authorized owner gets role-bound, single-use, hashed-only Redis tickets",
  async (t) => {
    const state =
      setup(t);

    const created =
      await rdp
        .createRDPSession(
          device,
          "Support session",
        );

    assert.equal(
      created.sessionId,
      session,
    );

    assert.deepEqual(
      state.notifications,
      [
        {
          channel:
            device,

          payload: {
            type:
              "rdp_available",
          },
        },
      ],
    );

    assert.equal(
      created.connection
        .relay,
      "wss://relay.example/rdp",
    );

    assert.equal(
      state.calls[0]
        .args
        .p_device_id,
      device,
    );

    assert.equal(
      state.calls[0]
        .args
        .p_user_id,
      "user",
    );

    assert.deepEqual(
      await rdp
        .consumeRDPTicket(
          created
            .connection
            .ticket,
        ),
      {
        sessionId:
          session,

        role:
          "client",
      },
    );

    await assert.rejects(
      rdp.consumeRDPTicket(
        created
          .connection
          .ticket,
      ),
      /INVALID_TICKET/,
    );

    const agentTicket =
      await rdp
        .issueRDPTicket(
          session,
          "agent",
        );

    assert.deepEqual(
      await rdp
        .consumeRDPTicket(
          agentTicket,
        ),
      {
        sessionId:
          session,

        role:
          "agent",
      },
    );
  },
);

test(
  "authentication, organization role, policy and capability fail closed",
  async (t) => {
    const state =
      setup(t);

    // No authenticated user
    state.client
      .auth
      .getUser =
      async () => ({
        data: {
          user:
            null,
        },
      });

    await assert.rejects(
      rdp.createRDPSession(
        device,
        "Support",
      ),
      /UNAUTHORIZED/,
    );

    // Restore authenticated user
    state.client
      .auth
      .getUser =
      async () => ({
        data: {
          user: {
            id:
              "user",
          },
        },
      });

    // User is not owner/admin
    state.records
      .organizations
      .owner_id =
      "another-user";

    await assert.rejects(
      rdp.createRDPSession(
        device,
        "Support",
      ),
      /FORBIDDEN/,
    );

    // Regular member cannot manage RDP
    state.records
      .organization_members =
      {
        role:
          "member",
      };

    await assert.rejects(
      rdp.createRDPSession(
        device,
        "Support",
      ),
      /FORBIDDEN/,
    );

    // Admin can manage, but policy is disabled
    state.records
      .organization_members =
      {
        role:
          "admin",
      };

    state.records
      .organization_remote_access_settings
      .rdp_enabled =
      false;

    await assert.rejects(
      rdp.createRDPSession(
        device,
        "Support",
      ),
      /RDP_DISABLED/,
    );

    // Policy enabled, but Agent capability missing
    state.records
      .organization_remote_access_settings
      .rdp_enabled =
      true;

    state.records
      .devices
      .capabilities
      .rdp =
      false;

    await assert.rejects(
      rdp.createRDPSession(
        device,
        "Support",
      ),
      /RDP_UNSUPPORTED/,
    );

    assert.equal(
      state.calls.length,
      0,
    );
  },
);

test(
  "membership and device reassignment revoke live sessions; closing cannot cross devices",
  async (t) => {
    const state =
      setup(t);

    assert.equal(
      await rdp
        .assertLiveRDPSession(
          state.records
            .rdp_sessions,
        ),
      900,
    );

    await assert.rejects(
      rdp.browserRDPSession(
        "other-device",
        session,
      ),
      /FORBIDDEN/,
    );

    state.records
      .clients
      .organization_id =
      "another-org";

    await assert.rejects(
      rdp.assertLiveRDPSession(
        state.records
          .rdp_sessions,
      ),
      /FORBIDDEN/,
    );

    state.records
      .clients
      .organization_id =
      "org";

    state.records
      .rdp_sessions
      .status =
      "closed";

    await assert.rejects(
      rdp.assertLiveRDPSession(
        state.records
          .rdp_sessions,
      ),
      /SESSION_ENDED/,
    );
  },
);

test(
  "request sizes and relay credentials reject malformed inputs",
  async (t) => {
    setup(t);

    for (
      const body of [
        "x".repeat(
          2049,
        ),
        "null",
        "[]",
        "not-json",
      ]
    ) {
      await assert.rejects(
        rdp.readRDPBody(
          new Request(
            "https://app.example",
            {
              method:
                "POST",

              body,
            },
          ),
        ),
        /INVALID_REQUEST/,
      );
    }

    for (
      const token of [
        "",
        "b".repeat(
          64,
        ),
        "a".repeat(
          63,
        ),
      ]
    ) {
      assert.throws(
        () =>
          rdp.authenticateRDPRelay(
            new Request(
              "https://app.example",
              {
                headers: {
                  Authorization:
                    `Bearer ${token}`,
                },
              },
            ),
          ),
        /UNAUTHORIZED/,
      );
    }

    assert.doesNotThrow(
      () =>
        rdp.authenticateRDPRelay(
          new Request(
            "https://app.example",
            {
              headers: {
                Authorization:
                  `Bearer ${"a".repeat(64)}`,
              },
            },
          ),
        ),
    );
  },
);