# Standalone realtime: gradual migration

The existing Vercel routes `app\api\realtime\agent\route.ts` and
`app\api\realtime\browser\route.ts` call `experimental_upgradeWebSocket`.
Each connection attaches a persistent handler, timers and a Redis REST/SSE
subscription. This is the code-level mechanism that can keep Vercel Functions
alive and consume Fluid Provisioned Memory. Billing attribution and the actual
reduction must be measured in Vercel; a code change alone does not move clients.

Before: Browser/Agent -> Vercel WebSocket handlers -> Redis/Supabase.
After opt-in: Browser/Agent -> dedicated Node relay -> the SAME Redis/Supabase.
Next.js retains pages, HTTP APIs, authentication, command submission, heartbeat,
update check/report and endpoint discovery. No second broker or protocol exists.
The standalone process imports the compiled `lib\realtime` handlers used by the
legacy routes. RDP binary transport remains on the separate existing RDP relay;
only its `rdp_available` notification passes through this realtime relay.

## Requirements and configuration

Use Node 22+ with npm. From the project root:

```powershell
npm ci
npm run build:realtime
npm run start:realtime
```

`build:realtime` compiles the existing TypeScript handlers using
`relay\tsconfig.json` into `dist\realtime`. It does not build or run Next.js.
Rebuild/restart the relay whenever shared handlers change. Start ultimately runs
`node relay\realtime-relay.mjs`. No Agent rebuild is required for Agents that
already implement endpoint discovery; older Agents remain on the legacy routes.

Required **relay** variables:

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project as the application |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only credential; never sent to browser |
| `UPSTASH_REDIS_KV_REST_API_URL` | Same existing Redis REST endpoint |
| `UPSTASH_REDIS_KV_REST_API_TOKEN` | Same server-only Redis credential |
| `SENTINELGRID_REALTIME_BROWSER_ORIGIN` | Exact application origin, no path or trailing slash |

Optional relay variables:

| Variable | Default / constraints |
| --- | --- |
| `NODE_ENV` | Set `production` on hosted services |
| `SENTINELGRID_REALTIME_BIND` | `127.0.0.1` |
| `SENTINELGRID_REALTIME_PORT` | `PORT`, then `8444` |
| `SENTINELGRID_REALTIME_MAX_CONNECTIONS` | `2000` per process, including unauthenticated sockets |
| `SENTINELGRID_REALTIME_TRUST_PROXY` | `false`; explicit private TLS proxy opt-in |
| `SENTINELGRID_REALTIME_TLS_CERT`, `SENTINELGRID_REALTIME_TLS_KEY` | Both PEM file paths for direct TLS, minimum TLS 1.2 |
| `SENTINELGRID_REALTIME_SHUTDOWN_GRACE_MS` | `30000`, bounded 0-300000 |
| `SENTINELGRID_REALTIME_ENV_FILE` | Optional explicit read-only env file |

The **application-only** `SENTINELGRID_REALTIME_URL` is an origin such as
`wss://realtime.example.com`, never a path, query, credential or fragment. It is
not `NEXT_PUBLIC_*`. Only this public origin is returned by discovery, not secrets.
Nothing in this change writes `.env.local`, rotates tokens or changes production.

In development (`NODE_ENV` unset or `development`), the standalone process
explicitly reads project-root `.env.local` then `.env` using native Node loading.
Existing process variables win. Production/test read no implicit files. An explicit
`SENTINELGRID_REALTIME_ENV_FILE` works in any mode and fails if unreadable.
Unlike Next.js, native Node loading does NOT expand `$VARIABLE` references: use
literal values or injected environment variables. No Next.js env loader is needed.

## Local development

Prepare the compiled handlers once with `npm run build:realtime`. Keep the same
isolated Supabase and Redis settings in both processes. Use two terminals:

```powershell
# Terminal 1, project root
npx vercel dev

# Terminal 2, project root
npm run start:realtime
```

Starting these processes alone does not change discovery. With the application
variable unset, clients continue to use the legacy endpoint. To exercise the
external path, supply a **trusted** local TLS certificate/key to the relay (or use
your existing local TLS proxy), set the relay browser origin to the exact origin
printed by Vercel dev, and set `SENTINELGRID_REALTIME_URL` in the application
process to the matching `wss://` origin. Restart Vercel dev after changing its env.
A loopback `http://localhost:<port>` browser origin is accepted in development
only. Discovery still requires WSS; do not disable Agent/browser TLS validation or
add insecure URLs to Agent configuration. We do not install a certificate or proxy.

Without TLS, `http://127.0.0.1:8444/healthz` provides a local liveness check, but
that cleartext listener is NOT a discoverable production WebSocket endpoint.
`next dev` is not assumed to implement Vercel's experimental WebSocket upgrade.

## Provider-neutral deployment

Deploy the same commit as the application to a persistent Node service:

- Build: `npm ci` then `npm run build:realtime`.
- Start: `node relay\realtime-relay.mjs` (on Linux: Node with the equivalent path).
- Inject the required server-only env variables and set `NODE_ENV=production`.
- Expose both existing WebSocket paths on the same public WSS origin.
- Keep outbound HTTPS to Supabase and Upstash, including long-lived SSE, enabled.
- Configure restart-on-failure, capacity limits, TLS renewal and logs at the host.

For Railway/Render/Fly.io/container TLS termination, explicitly set
`SENTINELGRID_REALTIME_BIND=0.0.0.0` and
`SENTINELGRID_REALTIME_TRUST_PROXY=true`. The private listener must not be reachable
from the public Internet. The trusted proxy must **replace** `X-Forwarded-Proto`
with the single value `https`; the relay rejects upgrades missing it or claiming
HTTP. A client-supplied header alone is NOT proof of TLS: firewall/private-network
isolation is required. Preserve the browser's Origin and WebSocket Upgrade headers,
and set idle/connection limits appropriate to persistent connections. Do not proxy
this traffic back through Vercel. Without the explicit opt-in or direct TLS, public
cleartext binds fail at startup, preserving the previous secure default.

A VPS can instead use a loopback listener behind its local TLS proxy, or direct TLS
with the two PEM paths. The exact HTTPS browser-origin check is always retained in
production. Ten-second authentication timeout, four-MiB payload limit, disabled
compression, 30-second WebSocket ping/pong, backpressure termination, subscription
cleanup, and existing presence refresh (15 seconds, TTL 45 seconds) remain intact.

Optional container, from the repository root:

```powershell
docker build -f relay\Dockerfile -t sentinelgrid-realtime .
```

The Dockerfile-specific allowlist excludes `.env*`, private keys, Agent artifacts
and unrelated application source from the build context. The image runs as
non-root, contains compiled shared handlers, and starts plain Node. Inject secrets
at runtime; never bake them into the image. Its default HTTP healthcheck is intended
for the **private TLS-terminating-proxy** deployment. If using direct TLS in the
container, override the healthcheck with an HTTPS check that trusts your certificate.
Do not publish the cleartext container port publicly. Configure the platform's port
as 8444 or override `SENTINELGRID_REALTIME_PORT` (it takes priority over `PORT`).

`GET /healthz` returns uncached `200 ok` while accepting connections and `503 draining`
during shutdown. It is liveness/acceptance, NOT proof that credentials, Redis or
Supabase work. SIGTERM/SIGINT refuse new upgrades immediately, preserve current
traffic for the configured grace period, then clean up sockets. Give the supervisor
more time than this grace. Drain is bounded, not a promise that a five-minute Terminal
command or update download will finish: keep old instances running through active
operations and migrate only when they are idle.

## Qualification and activation (no destructive automated actions)

1. Keep `SENTINELGRID_REALTIME_URL` unset in production. Deploy the relay first and
   check its public TLS certificate, health endpoint, private ingress and exact origin.
2. Use an isolated application deployment with the same source version and **test**
   Supabase/Redis. Set discovery there to the relay's WSS origin. Validate Agent token
   hash, device/Agent ID rejection, browser session and owner/admin/member boundaries.
3. Test presence, heartbeat, both Terminal shells/output, all eight Actions, receipt
   ordering, audit/Activity, RDP wake and the separate native RDP session. Use a
   disposable Windows device with console access for lock/reboot/shutdown/restart;
   automated tests only simulate these lifecycles and never invoke them on the host.
4. Qualify Update Agent separately: release check, download, signature/hash validation,
   updater handoff, restart, authenticated heartbeat and transaction success; also no
   new version, interrupted download and existing update/command recovery. Do not
   interrupt a real update merely to test the relay.
5. Test Redis interruption, reconnect, result replay, wrong-device messages, withheld
   persistence receipts on backend failure, mixed legacy/external peers and rollback.
6. Only then set `SENTINELGRID_REALTIME_URL=wss://<your-relay-host>` in the desired
   Vercel environment and deploy it. Verify `/api/realtime/endpoint` returns this origin
   with `Cache-Control: no-store`. Browser and discovery-capable Agents use it on
   their **next connection**. Existing sockets are not forcibly closed or redirected.
7. Keep both routes and the old infrastructure available. Watch relay connections,
   authentication/broker failures, presence, stuck commands, update transactions and
   Vercel route-level invocation duration/Fluid memory before considering route removal.
   Older Agents or existing legacy connections can still consume Vercel memory.

No authentication, schema, RLS, enrollment, signing, update validation, Terminal/RDP
protocol, receipt sequencing or audit implementation was changed. In particular,
non-update actions still wait for `typed_command_receipt: running` after backend
persistence. Update transactions remain authoritative through the existing HTTP
report endpoint; generic typed results cannot finalize a correlated transaction.
The per-Agent 15-second redelivery/deadline recovery and standalone 30-second global
recovery are retained; this change does not replace realtime with polling.

Device Actions retain initial availability prefetch/cache and five-second freshness
while the menu is open and the tab visible. Closed/hidden menus no longer make a
request every five seconds. Reopen/visibility and busy/online changes refresh when
needed; command-status tracking and POST authorization/safety revalidation remain
unchanged. No new status WebSocket or Supabase publication was introduced.

## Rollback

Remove `SENTINELGRID_REALTIME_URL` from the application environment and redeploy (or
restore the previous known-good application deployment). Confirm discovery returns
`{"origin":null}`. This restores legacy selection without an Agent configuration,
enrollment or token change. Leave the external relay running until active operations
finish. Connected peers remain there until reconnect; reconnecting peers discover the
legacy endpoint. Both sides continue to communicate through the same Redis channels.
Only drain/stop the external relay after discovery is reverted and active work is
idle. If it has already failed, Agents rediscover with existing jittered backoff
(up to five minutes); browsers retry through existing Terminal reconnect logic.
Rollback selection is immediate once deployed, **not** instant migration of every
socket. Invalid configured URLs fail explicitly rather than silently downgrading.
There is no automatic failover to Vercel on broker or authentication failures.

## Checks

```powershell
npm run build
npm run build:realtime
npm run test:realtime
node --test scripts\test-device-actions.mjs scripts\test-device-actions-menu.mjs scripts\test-device-action-feedback.mjs scripts\test-device-terminal.mjs scripts\test-device-activity.mjs scripts\test-update-command-feedback.mjs scripts\test-agent-update.mjs scripts\test-rdp-policy.mjs scripts\test-rdp-http.mjs scripts\test-rdp-relay.mjs
cd agent
go test ./...
go vet ./...
```

Automated checks are not production qualification. Do not disable legacy routes
until a real deployed relay and installed signed Agent pass the checklist above.
