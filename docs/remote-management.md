# Remote management

## Delivery status

The existing terminal transport and typed-command execution are unchanged. RDP now
has a separate native-client/outbound-relay path, not a Guacamole/browser scaffold.
Local byte-stream, authorization, revocation, HTTP rejection and PostgreSQL tests
are not proof of an interactive Windows desktop session. That qualification still
requires an enrolled, RDP-enabled Windows Pro/Enterprise/Server test endpoint, a
trusted TLS relay, an AAL2 SentinelGrid user and Windows logon rights.

## RDP architecture

1. An authenticated organization owner/admin enters a reason in Device View and
   requests Remote Desktop. The server requires AAL2, current device ownership,
   fresh online inventory, `rdp`/`tcp_tunnel`, organization policy and rate limits.
2. `create_rdp_session` serializes admission on the organization settings row. It
   enforces the session limit (including existing terminal sessions), one RDP
   tunnel per device, and writes the request and audit event atomically.
3. Device View downloads a `.sgrdp` file containing a **60-second, one-use client
   ticket**, relay URL and expiry. Redis holds only a SHA256 ticket hash and its
   session/role binding. There are no Windows passwords in this file.
4. Run the signed Windows operator connector within 60 seconds:

   ```powershell
   .\SentinelGridRDP.exe -connection "$env:USERPROFILE\Downloads\SentinelGrid-<session-id>.sgrdp"
   ```

   The connector consumes/removes the connection file, opens an outbound WSS
   connection and launches the installed Windows `mstsc.exe` client. It accepts
   exactly one local TCP connection on an ephemeral **127.0.0.1-only** listener.
5. The enrolled Agent polls a separate HTTPS API every ten seconds when its fixed
   local Windows RDP listener passes a CredSSP/NLA negotiation probe. The backend
   issues a different, one-use **agent-role** ticket for the same session. The
   permanent Agent token is never sent to the relay.
6. The relay redeems tickets through its authenticated HTTPS control endpoint and
   pairs only matching session IDs with different roles. The Agent connects only
   to `127.0.0.1:3389`; neither user nor backend can supply a TCP destination. The
   relay forwards bounded binary frames with backpressure. The terminal WebSocket
   routes and Redis channels are not reused or modified.
7. Enter Windows credentials **only in Windows Remote Desktop**. RDP/CredSSP remains
   end-to-end across the relay. Since the client connects through loopback, check
   the endpoint certificate independently when Windows warns about its name/trust.
   No certificate-verification bypass is installed. This is an administrator
   support workflow, not unattended Windows credential provisioning.
8. Close the native client, press Ctrl+C in the connector, or select **Close Remote
   Desktop** in Device View. Active sessions can be found again after navigating
   back to the device. The relay rechecks expiry, membership, device organization,
   capability and policy every five seconds with an eight-second request timeout;
   revocation/control-plane failure disconnects within approximately 15 seconds.

`active` means the **tunnel is paired**, not that Windows authentication succeeded
or a human controlled the desktop. Audit records distinguish request/close/failure
and contain IDs, reason and timing, never tickets, keystrokes, screen contents or
Windows passwords. Closing disconnects RDP; it does not forcibly log the Windows
user off or close their applications. Configure Windows session/logoff policies
separately where required.

The relay honors a maximum duration and a transport-idle timer. Encrypted RDP bytes
cannot identify human keyboard/mouse inactivity: enforce that policy in Windows,
not by pretending packet inactivity measures user activity. Client clipboard,
drives, printers, COM ports, smartcards, devices and microphone redirection default
off. Settings granting those features do not enable them in this connector.

## Test infrastructure

Apply the checked-in migrations **in filename order** after the existing baseline
organization/client/device/audit schema. Use a designated test Supabase database,
not an inferred production project from `.env.local`. These scripts restore missing
schema definitions and add RDP; existing database constraints/policies must be
reviewed before deployment. The qualification test uses PostgreSQL-in-WASM (PGlite)
with explicit Supabase auth/storage fixtures and no production credentials.

Required services:

- Existing Next.js application and Supabase; existing Upstash REST Redis.
- A single long-lived Node process, `relay\rdp-relay.mjs`, reachable by both the
  Agent and operator over trusted WSS. It is **not a Vercel route**. Do not put
  multiple replicas behind a load balancer: the connection pairing is local to
  one relay process. Restart disconnects sessions rather than guessing a peer.
- Existing Windows Remote Desktop hosting with NLA on the test endpoint; Windows
  Home cannot host this session. No Go, WiX, SDK, Node or SignTool is needed there.
- The signed `SentinelGridRDP.exe` on the operator's Windows PC; `mstsc.exe` is a
  Windows component. The connector is a build artifact, not an Agent MSI component.

Configure the commented RDP variables in `.env.example`. Generate the shared
relay secret once with a cryptographically secure random generator and store it
only in the app/relay secret configuration. Never put it in a public environment
variable, browser bundle, command-line argument or committed file.

```powershell
# Dependencies are the repository's locked npm dependencies.
npm ci
# Supply relay variables in the process environment or a protected, ignored file.
node .\relay\rdp-relay.mjs
curl.exe --fail http://127.0.0.1:8443/healthz
```

Without explicit TLS files, the relay refuses non-loopback bindings. Put that
listener behind a trusted TLS WebSocket proxy, or supply the public chain/private
key using the relay-only variables. Restrict key-file ACLs; do not log authorization
headers or ticket bodies at the proxy. No public 3389 listener or firewall exception
is needed: only outbound HTTPS/WSS and local RDP are used. Disable existing broad
inbound RDP rules on designated tests only after assessing other administration
paths; the repository does not change firewall rules automatically.

Enable `remote_access_enabled` and `rdp_enabled` only for the isolated organization.
The SQL admission path requires a reason, validates the actual device organization
again, and grants mutation/RPC execution only to the backend service role. Browser
routes authenticate themselves, return JSON rather than login redirects, and check
same-origin mutation requests. Relay routes use a separate shared secret, not
browser cookies. Failures are explicit; there is no unauthenticated fallback.

## Diagnostics and reproducible checks

```powershell
# Non-mutating endpoint probe (from a built or installed Agent):
.\SentinelGridAgent.exe -rdp-readiness

Push-Location agent
gofmt -w .
go test ./...
go vet ./...
Pop-Location
node --test scripts\test-rdp-policy.mjs scripts\test-rdp-relay.mjs scripts\test-agent-migrations.mjs
npm run build
node scripts\test-rdp-http.mjs
```

Relay tests use real loopback WebSocket connections and verify binary integrity,
role/session isolation, replay rejection, expiry/pair timeout, revocation, oversized
frames and cleanup. Go tests exercise a real WebSocket/TCP byte-stream bridge and
cancellation. HTTP checks start and stop a loopback-only Next.js process and preserve
`dist\qualification\web-smoke.log`. None of these represents a real interactive
RDP sign-in. Positive qualification must include clicking in Windows, disconnecting,
revoking membership/session access, and checking audit receipts on the test backend.

## Existing terminal and typed actions

The terminal remains on its existing browser/Agent realtime routes. Typed actions
remain durable `device_commands` plus Redis dispatch, fixed Agent-side action
validation and correlated results. Reboot/shutdown/lock/update require existing
high-risk authorization. Restart-Agent/force-inventory remain explicitly unsupported
where the existing Agent advertises no capability; this RDP work does not add shell
fallbacks or claim those independent actions work.
