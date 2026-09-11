# Agent build and update

## Delivery status and safety gate

Production remains fail-closed: `Qualified = false` in
`agent\internal\update\transaction.go`. No runtime environment variable,
CLI option, API response or certificate-store change can enable a production build.
The explicit `-DevSign` development qualification path is documented at the end
of this file. It uses a separate build tag and explicit development signer pin;
compilation alone does not qualify an installed machine. Authenticode remains required.

The installed 0.1.5 Agent and Updater were inspected during development-path work:
both services were Running and both executables were NotSigned. They were not changed
and remain unsuitable for an automatic update or a verified rollback baseline.
No certificate was created, trust store changed, release published or update requested.

Current validation: Windows Go format/tests/vet pass in both ordinary and development
build configurations. Node policy/report tests, TypeScript, focused ESLint, the web
build and PowerShell syntax/mode rejection tests pass. Signed artifacts, real positive
installed readiness, MSI lifecycle and power-loss/rollback qualification remain
UNVERIFIED. The migration files referenced by the earlier integration report below
are absent from this checkout; database/RLS/RPC qualification is also UNVERIFIED.
Earlier integration validation sections are historical, not current qualification.

## Prerequisites

Build on Windows x64 with PowerShell 5.1 or later, Go 1.25 or later (`go`, `gofmt`,
and `go tool vet`), WiX CLI supporting the existing v4 schema (`wix build`), and the
Windows SDK SignTool for signed builds (PATH or the installed Windows Kits SDK). No tools are installed by the script.
Tests run natively, not as an unexecuted cross-compilation. Go modules must be
available through your normal approved module configuration.

Production builds also require a trusted code-signing certificate with an accessible
private key in `Cert:\CurrentUser\My` or `Cert:\LocalMachine\My`, the expected leaf
certificate SHA256 fingerprint, and an HTTPS RFC3161 timestamp service. Use the
certificate store/HSM provider; the script does not accept passwords or import PFX
files. Store/HSM access policy is managed outside the repository.

The web application uses its existing Node/npm dependencies and Supabase setup.
The new endpoints use `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` through
`lib\supabase\admin.ts`. Existing heartbeat/realtime credentials are unchanged.

## Commands and versioning

From the repository root:

```powershell
# Explicit local development: unsigned dev binaries, no MSI.
.\scripts\build-agent.ps1 -Dev -SkipMSI

# Explicit development build including the existing MSI flow.
.\scripts\build-agent.ps1 -Dev

# Signed build using agent\VERSION and stable channel.
.\scripts\build-agent.ps1

# Explicit signed releases; use a version newer than installed MSI versions.
.\scripts\build-agent.ps1 -Version 0.1.5 -Channel beta -Sign
.\scripts\build-agent.ps1 -Version 0.1.6 -Channel stable -Sign
```

`agent\VERSION` is the authoritative default (currently `0.1.4`, aligning the
previous MSI version). `agent\version.go` embeds it, including for direct `go build`.
`-Version` overrides that default for one build via `-X sentinelgrid/agent.Override`.
The same value drives Agent inventory/heartbeat, both executable `-version` outputs,
WiX `AgentVersion`, directory names, and the manifest. No TypeScript version constant
exists. Passing `-Version` does not rewrite the default VERSION file.

MSI requires numeric version limits: `major.minor.patch`, at most `255.255.65535`.
Release builds reject suffixes rather than silently dropping them from the MSI
version. Use dev/beta/stable channels for release rings and monotonically increasing
versions. The update protocol comparator supports full semantic-version precedence,
including numeric prerelease identifiers, and ignores build metadata for ordering.
Same versions and older versions never update. Channels are not permission to downgrade.

Signing is mandatory unless `-Dev` explicitly requests unsigned local development.
`-Dev -Sign` produces signed dev artifacts. `-SkipMSI` requires `-Dev`. Production
mode never silently skips tests, vet, signing, signature verification, or MSI creation.
There is intentionally no skip-tests release switch.

The script checks prerequisites first, runs gofmt over Agent Go sources, runs all
Go tests and vet, builds Windows amd64 Agent/updater, verifies their reported versions,
signs and verifies each executable, builds the existing WiX package directly from
the output executables, signs/verifies the MSI, and hashes the final signed bytes.
The concise final report distinguishes `OK` from explicitly skipped development steps.

An exclusive build lock prevents concurrent output corruption. Existing version
folders are never overwritten, including partial failed builds. Inspect/archive a
failed build before retrying its version, or choose a fresh version. No executables
are copied to source directories, `public\downloads`, Storage, or installed machines.

## Signing configuration

Set environment variables in the build process, not in committed source:

```powershell
$env:SENTINELGRID_SIGN_CERT_THUMBPRINT = '<40-hex-certificate-store-thumbprint>'
$env:SENTINELGRID_UPDATE_SIGNER_SHA256 = '<64-hex-SHA256-of-leaf-certificate-DER>'
$env:SENTINELGRID_SIGN_TIMESTAMP_URL = 'https://<your-approved-timestamp-service>'
.\scripts\build-agent.ps1 -Version 0.1.5 -Channel beta -Sign
```

For a machine-store certificate, add `-CertificateStore LocalMachine`. Parameters
`-CertificateThumbprint`, `-TrustedSignerSHA256`, and `-TimestampUrl` can override
environment values. The build script does not load `.env` files automatically.
`.env.example` contains placeholders only.

SignTool signs with SHA256 and an RFC3161 SHA256 timestamp; `signtool verify /pa /all`
and `Get-AuthenticodeSignature` must succeed. The resulting leaf certificate SHA256
must match the embedded allowlist. The SHA1 thumbprint only selects the certificate
from Windows; it is not the artifact hash or runtime trust identity.

Runtime verification uses Windows Authenticode trust through
`Get-AuthenticodeSignature`, requires `Valid`, and independently compares the leaf
certificate SHA256 against pins compiled into Agent/updater. No development bypass
exists in the verifier. API metadata cannot change the pins. PowerShell is invoked
using its Windows system path, with a fixed script and data-only environment values,
not server-supplied commands. No new privileged command-execution endpoint exists.

For rotation, embed both old and new certificate fingerprints (comma-separated)
in a signed baseline MSI before using the new signer. Keep the old signer long enough
for the fleet to receive overlapping trust. This implementation does not self-update
the helper; helper/trust-store changes require a signed MSI deployment.

## Artifact layout

```text
dist\agent\0.1.5\
  SentinelGridAgent.exe
  SentinelGridUpdater.exe
  SentinelGridAgent-0.1.5.msi
  manifest.json
  checksums.txt
```

WiX can additionally emit its `.wixpdb` sidecar. `dist` and generated executables are
ignored by Git. `manifest.json` contains schema/product/version/channel/platform,
build-time `published_at`, signing/qualification flags, public signer fingerprints,
and artifact filename/SHA256/size. It contains no credentials. `checksums.txt` also
covers the manifest. A local build timestamp does not mean the release was published;
the database `published_at` is the actual availability timestamp.

## Installer compatibility

The existing UpgradeCode, Agent service identity (`SentinelGridAgent`, LocalSystem),
installation directory (`Program Files\SentinelGrid`) and config
(`ProgramData\SentinelGrid\agent.json`) are preserved. The helper is a separate MSI
component in the same install directory; no helper service is registered yet.
WiX receives `AgentVersion`, `AgentSource`, and `UpdaterSource` from the build script.
Raw `wix build` invocations must now supply these values; prefer the one-command script.

Fresh MSI installs still use the original enrollment-token filename custom action.
Major upgrades skip reenrollment with `WIX_UPGRADE_DETECTED`, preserving existing
credentials. Merely building an MSI does not publish it as the enrollment download.
The existing public MSI download route and filename contract are unchanged.
After verification, deployment of a new bootstrap MSI through the existing download
channel remains an explicit administrator release step.

## Storage and publishing

Apply `supabase\migrations\202609110002_agent_build_and_update.sql` to a test project
first, after the existing remote-management migration and baseline organization,
client and device schema. It creates:

- `agent_releases`: immutable-version metadata, active flag, publication time,
  channel, Windows/amd64 identity, object path, SHA256 and byte size.
- `organization_agent_update_settings`: automatic updates, channel, and delay hours.
- `device_agent_update_state`: latest version, effective channel, coarse update
  states/timestamps/error codes, failed version and durable server-side rate limits.

The migration creates/keeps `agent-releases` **private**, with a 256 MiB object limit.
It grants no client upload or object-read policy. Review any pre-existing broad
`storage.objects` policies: they must exclude this bucket. Only trusted backend/admin
infrastructure may upload, publish or activate releases. Never expose an admin key
to a browser or an Agent.

Publishing is deliberately manual and never happens in the build script:

1. Build/sign/verify a release; archive its original manifest/checksums.
2. Using a trusted Supabase administrator, upload the final Agent, updater, MSI,
   manifest and checksums to `agent-releases/<channel>/<version>/`. Use immutable
   objects; do not overwrite an already-published version. The Agent object must be
   exactly `<channel>/<version>/SentinelGridAgent.exe`. Use `application/octet-stream`
   for executable/MSI uploads if the upload client chooses an unsupported MIME type.
3. Create an inactive `agent_releases` row using the manifest Agent hash and size.
   Set `created_by` to the publishing administrator, and optionally add release notes.
   Independently download through trusted admin tooling and verify the uploaded bytes.
4. Activate the row only after release approval. Set database `published_at` to the
   intended UTC availability time. Deactivate withdrawn versions; keep the set of
   active eligible releases per channel below 500. The API fails rather than selecting
   from a truncated release set.
5. Start with a dedicated beta organization. Leave
   `SENTINELGRID_AGENT_UPDATES_ENABLED=false` until the qualification work is complete.

Example metadata insertion in trusted Supabase SQL tooling (replace placeholders):

```sql
insert into public.agent_releases
  (version, channel, storage_path, sha256, size_bytes, is_active, published_at)
values
  ('0.1.5', 'beta', 'beta/0.1.5/SentinelGridAgent.exe',
   '<64-hex-agent-hash-from-manifest>', <agent-byte-size>, false, now());
```

Members may read active release metadata and their current organization's device
update state. Only owners/admins can change their organization's policy. Clients
cannot write device update state or invoke the service-role-only rate/report functions.
Release publication has no authenticated-user write grant or RLS policy. Device-state
membership follows the device's current client, avoiding stale organization ownership.

## API and check policy

`POST /api/agent/update/check` uses the existing bearer-token SHA256/device lookup.
It derives organization through the authenticated device's client and takes current
version from authenticated inventory. An Agent cannot select an organization/channel
by supplying one in the body. Unknown inventory versions return an explicit error.

It selects the highest eligible semantic version, honors channel and publication delay,
and returns product/platform/architecture/current/latest/channel/availability/policy.
Missing policy rows mean `automatic_updates=true`, `channel=stable`, zero delay.
A global backend kill switch defaults off. Only when that switch is on and inventory
advertises `agent_update=true` can it issue a private Storage URL valid for 15 minutes,
with SHA256, size and expiry. Responses are `Cache-Control: no-store`; binaries never
pass through a Next.js response. Signing a URL does not itself authorize installation:
the dispatcher enforces local readiness and automatic/manual policy and rechecks
trusted policy after download before publishing the pending transaction.

`POST /api/agent/update/report` accepts a bounded JSON report with a known coarse state,
an optional target semantic version and an optional allowlisted error code. Device and
organization identity cannot be supplied. It does not accept free-form errors/URLs or
credentials. Diagnostics are not treated as cryptographic proof of update success.

Migration `202609110003_agent_update_execution.sql` adds private durable transaction
receipts and typed-command correlation. UUID transaction/command IDs are optional
for backward-compatible observation reports. Correlated reports atomically bind
the authenticated device, target version and empty-payload `update_agent` command.
Only a terminal journal report finalizes that command; retries are idempotent.
The updater service has no server credentials or network reporting responsibility.

Server checks are atomically rate-limited to one per device per minute; changed reports
to 20 per minute, with duplicate reports deduplicated. These limits are abuse protection,
not the normal scheduling frequency.

The Windows Agent checks **1-4 minutes after startup**, then **every 5-7 hours**
(six hours with jitter). It persists the next check *before* making a request, so
network failures and service restart loops do not hammer the API. The background
worker has bounded HTTPS requests, refuses redirects, redacts network error details,
and never blocks heartbeat, inventory, enrollment or terminal operation. An insecure
or unavailable update directory disables checks with a log message; it does not
silently use an unprotected fallback.

Effective channel resolution is separate from release selection and already has a
future per-device override input. No override is currently persisted or accepted from
an Agent. Use separate organizations for dev machines, beta cohorts and stable production.
Only reliable UTC publication delay is implemented; there is no misleading unimplemented
maintenance-window or timezone setting.

## Transaction and rollback implementation

Protected staging is `ProgramData\SentinelGrid\updates`. Windows Known Folder APIs
resolve paths, not incoming metadata. The updater validates trusted ownership/write
ACLs of config/install ancestors and staging entries, rejects reparse points and
unexpected subdirectories, and applies an inheritance-protected SYSTEM/Administrators
DACL to staging. It refuses insecure existing ancestors rather than changing the
existing enrollment configuration's permissions automatically. An administrator must
review and secure those ancestors before enabling the updater.

The download routine accepts only unexpired HTTPS metadata for SentinelGridAgent,
Windows/amd64 and a known channel; it rejects redirects, oversized/truncated downloads,
hash mismatch, unsigned/untrusted signatures and unexpected signed product/version.
It creates the staging file exclusively. The helper re-verifies the artifact rather
than trusting an Agent-side verification flag. Download URLs and Agent tokens are
never written into the journal. Pending metadata is embedded in `state.json`, not
a separately published `pending.json`, so the ownership reservation is atomic.
It contains schema, version, channel, hash, size and dispatch expiry only.

The transaction uses a Windows exclusive file handle as the cross-process update lock
and a write-through, atomically replaced journal. It retains `previous.exe` before
stopping the service, atomically replaces the fixed installed Agent path, starts the
fixed SCM service, and validates a stable running PID for at least **60 seconds**.
A post-start health marker containing the expected version/PID and successful heartbeat
timestamp confirms config initialization and reconnect. New-Agent health is bounded
to **3 minutes**, service stop to **60 seconds**, install helper to **10 minutes**.

Install/start/health failures invoke rollback capped at **4 minutes**:
stop, restore previous executable, restart and confirm previous health, then record
`rolled_back`. Shutdown cancels the current work and leaves durable recovery intent;
it never starts an uncancellable replacement during shutdown. Recovery attempts are
incremented and flushed BEFORE each rollback attempt. After three failed attempts,
`failed` / `ROLLBACK_FAILED` is terminal: preserve journal and backup, block new
updates, and require administrator repair. A heartbeat cannot be reported remotely
if neither Agent can start; in that case diagnostics remain in the protected journal.

The MSI registers `SentinelGridUpdater` as an automatic LocalSystem own-process
service at the fixed Program Files executable. It polls the journal every ten seconds
while qualified. SCM permits two delayed crash restarts then no further restart in
that failure sequence; boot starts it again, without resetting journal attempt counts.
It has no arbitrary execution input, download URL or Agent token. The old `-apply`
mode is removed. Version/protocol queries and fixed MSI coordination modes are the
only executable flags; normal execution requires SCM service context.

The Agent owns the existing exclusive `update.lock` throughout checking, download,
verification, rechecking policy and publishing the pending journal. It never writes
its installed executable. On release of that handle, active journal state continues
to reserve the transaction, so another scheduler/typed command cannot stage update B.
The already-running service acquires the SAME lock and revalidates the candidate
before stopping the Agent. Candidate file handles deny write/delete sharing through
replacement. Metadata opens reject reparse points and hardlinks; pending schema is
strictly allowlisted. Files and paths come only from Windows Known Folder APIs.

On a recovery-service restart, `downloading`/`staged` transactions are abandoned
without changing the old executable; expired/unacknowledged handoffs also abort.
`installing`, `restarting` and interrupted rollback states restore the signed previous
Agent, including when the candidate had already replaced it. Recovery does not
blindly retry a new release after reboot. Completed successful/rolled-back/pre-install
failed transactions permit deletion of ONLY `previous.exe`, `candidate.exe` and the
legacy `pending.json`. Active and rollback-failed states permit no cleanup. The journal
and failed-version history are never deleted by startup or cleanup.

The journal stores up to 128 failed versions and refuses further staging when full;
it never evicts a failed version to enable an accidental retry. Semantic-equivalent
versions differing only in build metadata stay suppressed. Terminal delivery retries
every 30 seconds after Agent restart, and a transaction is not reused until acknowledged.

`Operational()` checks: source qualification; Windows amd64; LocalSystem identity;
fixed protected install/config/staging locations; trusted ownership and write ACLs;
ancestor delete/ACL security; no reparse paths; pinned single-link metadata; loadable
fixed HTTPS config; writable atomic journal storage; no terminal rollback failure;
no shutdown or maintenance marker; signed updater at the fixed path; pinned signer;
matching major/minor updater version plus protocol `1`; automatic LocalSystem
Agent/updater services with fixed executable paths; correct running Agent/updater
PIDs; bounded SCM recovery policy; and service DACLs denying untrusted control/config
writes. A concise reason is logged when readiness changes. Basic Agent features do
not depend on this probe succeeding.

Authenticated heartbeat confirmation requires HTTPS without redirects, a successful
response for the configured device, loaded config, the expected version and the fixed
Agent process. Protected markers bind transaction UUID, PID AND process creation time,
preventing stale/PID-reuse acceptance. Validation requires a heartbeat newer than the
service start, at most 90 seconds old, and a stable running process for 60 seconds.

MSI coordinates using the same update lock: a bounded 90-second quiesce phase rejects
active transactions, durably records SentinelGrid-only maintenance intent, and stops
recovery before MSI file operations. Commit/rollback clears the marker and restores
recovery as appropriate. An interrupted MSI leaves a fail-closed marker until MSI
repair/rollback completes. Unrelated MSI installations are not blocked. MajorUpgrade
uses `afterInstallExecute` to retain old components for rollback, with unchanged
UpgradeCode, component identities, Agent service identity and enrollment condition.
This sequencing must pass native upgrade/uninstall/rollback qualification before use.

Automatic dispatch additionally requires the server's `installation_enabled=true`
(backend kill switch plus advertised capability) AND organization automatic policy.
Manual `update_agent` requires an empty payload and may check despite automatic policy
being off, but cannot bypass the global switch, readiness, release policy or suppression.
It acknowledges/runs through the existing typed lifecycle and deliberately does NOT
send synchronous success. The replacement/rolled-back Agent delivers the terminal
journal through the report API; the server finalizes the correlated command and audit
record atomically. No-op checks fail explicitly rather than pretending an install ran.

## Verification and first real update test

Current development verification:

```powershell
Set-Location agent
gofmt -w .
go test ./...
go vet ./...
Set-Location ..
node --test scripts\test-agent-update.mjs
node node_modules\typescript\bin\tsc --noEmit
npm run build
git diff --check
```

Focused ESLint should cover `lib\agent\update-*.ts`, the two update routes,
capability normalization, `lib\remote\commands.ts`, and the existing Device View file.
The Go tests cover semantic ordering, no-op/downgrade detection, failed-version retry
protection, channels, hash/size/unsigned rejection, update locks, install/start/health
rollback, success, interrupted transactions and the disabled typed command. Native
Windows tests also exercise the real exclusive-file lock and Authenticode rejection.

Before the **first real auto-update test**, all of these are required:

1. Keep the source and server gates closed. Install Go 1.25+, WiX and SignTool on an
   approved Windows test machine and execute the commands above. Go formatting/tests,
   service registration and MSI qualification remain UNVERIFIED here. Do not activate
   the source gate until these component tests pass; there is no runtime bypass.
2. On a disposable Windows VM with snapshots, install prerequisites and run all Go
   checks. Build signed baseline `0.1.5` and target `0.1.6` with the intended signer pins.
   Verify both executable `-version` outputs, all `signtool verify /pa /all` results,
   certificate fingerprints, manifest sizes and `Get-FileHash -Algorithm SHA256` values.
3. Apply/review both update migrations (`202609110002` and `202609110003`) in a test
   Supabase project. Test transaction replay/idempotency and anonymous/member/admin
   access, cross-organization policy/state denial, direct release-write denial and
   private-bucket access. Configure the existing Supabase server credentials and keep
   the update kill switch off during preparation.
4. Deploy the baseline through the existing enrollment MSI filename/download flow.
   Confirm enrollment token handling, preserved `agent.json`, service startup,
   inventory/heartbeat version and unchanged terminal/typed actions. Test upgrading an
   already-enrolled earlier MSI without requesting a new enrollment token.
5. Secure/review the existing ProgramData/config/install ancestor ACLs, then verify
   normal users cannot replace, rename, hardlink or redirect staged/installed files.
6. Upload and verify target artifacts privately; insert and activate the beta release;
   set the test organization's beta policy with zero delay. Confirm a same-version
   release and an older version return no update.
7. After native component tests pass, review and enable the source qualification gate
   in a disposable-VM-only build, then rebuild both signed versions (archive earlier
   outputs first; the build script refuses overwrite). Verify `sc.exe qc SentinelGridUpdater`,
   `sc.exe qfailure SentinelGridUpdater` and `SentinelGridUpdater.exe -protocol` (`1`).
   After readiness advertises true, enable the backend kill switch only in the test
   deployment. Test both automatic checks and the existing empty-payload Update Agent
   action. Success must follow 0.1.6 heartbeat health, never the initial download.
8. Inject hash mismatch, unsigned/wrong-signer artifacts, expired URLs, parallel update,
   config initialization failure, service-start failure, lost heartbeat, shutdown and
   power loss at each replacement/journal boundary. Confirm bounded rollback/recovery,
   old Agent connectivity and persistent failed-version suppression before production.

No release was uploaded, migration applied, certificate generated, or installed Agent
upgraded by these repository changes. Existing unrelated working-tree changes are not
part of this build/update implementation.

### Files changed by the execution-path integration

The prior working-tree changes are preserved. This continuation changed/added:

```text
agent\cmd\sentinelgrid-agent\main.go
agent\cmd\sentinelgrid-updater\main_windows.go
agent\internal\api\client.go
agent\internal\inventory\inventory.go
agent\internal\realtime\actions.go
agent\internal\realtime\actions_windows.go
agent\internal\realtime\update_action_test.go
agent\internal\update\artifact.go
agent\internal\update\checker.go
agent\internal\update\checker_other.go
agent\internal\update\checker_windows.go
agent\internal\update\current_windows.go
agent\internal\update\handoff.go
agent\internal\update\health.go
agent\internal\update\heartbeat.go
agent\internal\update\heartbeat_test.go
agent\internal\update\host_windows.go
agent\internal\update\host_security_windows_test.go
agent\internal\update\integration_test.go
agent\internal\update\maintenance_windows.go
agent\internal\update\pending.go
agent\internal\update\readiness.go
agent\internal\update\readiness_windows.go
agent\internal\update\recovery_bounds_test.go
agent\internal\update\recovery_windows.go
agent\internal\update\registration_windows.go
agent\internal\update\transaction.go
agent\internal\update\transaction_test.go
app\api\agent\update\report\route.ts
app\api\realtime\agent\route.ts
app\dashboard\organizations\[id]\clients\[clientId]\device-dashboard.tsx
installer\windows\Package.wxs
lib\agent\update-report.ts
lib\remote\commands.ts
scripts\test-agent-update.mjs
supabase\migrations\202609110003_agent_update_execution.sql
docs\agent-build-and-update.md
```

The existing build script, VERSION, environment files, initial migrations and check
API were not rewritten. Device View changes only wire the existing button; the Agent
realtime route only protects correlated update results. Browser realtime and terminal
transport are unchanged. API redirects now fail explicitly to prevent credentials or
health confirmation from following a redirect to an unintended endpoint.

### Integration validation results

Seven Node update-policy/report parser tests, TypeScript `--noEmit`, focused backend
ESLint, `npm run build`, `git diff --check`, MSI XML parsing and existing PowerShell
build-script syntax parsing passed. The focused Device View lint additionally reports
the pre-existing unused `Wifi` import; it was not changed. Build retains the existing
metadataBase and MSI-download prerender warnings. Native `gofmt -w .`, `go test ./...`,
`go vet ./...`, executable/MSI builds, signatures, SCM behavior and the Supabase SQL
integration are UNVERIFIED, not passing results. No tools were installed automatically.

Added Go tests cover handoff ownership, unknown metadata, readiness failures/success
with injected checks, expired policy, power/MSI exclusion, recovery before/after
replacement, crash/restart bounds, heartbeat identity/freshness/stability, health
timeout, rollback failure, failed-version serialization and safe cleanup. Native
Windows tests add pinned-file sharing, durable journal reload, missing updater,
maintenance-marker refusal and backup retention. Real signer/SCM/MSI fault injection
is still required; mock readiness success is not Windows qualification.

### Historical production-signing test commands (source gate remains disabled)

Configure the existing certificate-store signing variables described above. Keep real
values out of the repository. On the approved Windows build machine:

```powershell
Push-Location agent
gofmt -w .
go test ./...
go vet ./...
Pop-Location
.\scripts\build-agent.ps1 -Version 0.1.5 -Channel beta -Sign
.\scripts\build-agent.ps1 -Version 0.1.6 -Channel beta -Sign
```

Install 0.1.5 on a snapshot-backed VM using the existing token-filename enrollment
flow. Verify both fixed services, preserved configuration, heartbeat version, updater
protocol and protected ACLs. Apply both update migrations to a TEST Supabase project.
Upload only the verified final 0.1.6 Agent bytes to the PRIVATE `agent-releases` bucket
at `beta/0.1.6/SentinelGridAgent.exe`; insert matching SHA256/size metadata, then activate
that release and set the test organization's channel to beta, delay to zero and
automatic policy as appropriate. Only after local readiness is true, set the test
backend `SENTINELGRID_AGENT_UPDATES_ENABLED=true`. Use the existing Update Agent action
with `{}` or wait for the 1-4 minute startup/5-7 hour scheduler. Inspect `state.json`,
versioned authenticated heartbeats and terminal command status. Snapshot-restore for
each failure case; do not clear failed-version state merely to make a retry work.
Exercise reboot/power-loss at every durable phase, updater termination, missing
heartbeat, service-start failure, MSI concurrent repair/upgrade/uninstall and interrupted
rollback before approving any non-disposable deployment. A current gate-off build will
NOT update regardless of server settings.


## DEVELOPMENT ONLY qualification (0.1.5 -> 0.1.6)

### Trust boundaries

- Ordinary builds, including production signing and unsigned `-Dev` builds, retain
  the false production source gate. Development environment variables are ignored
  by production trust selection. There is no runtime qualification toggle.
- `-DevSign` explicitly compiles both executables with
  `sentinelgrid_dev_update` and injects exactly one
  `DevelopmentSignerSHA256` leaf-certificate fingerprint. It cannot be combined
  with `-Sign`, `-Dev` or `-SkipMSI` and requires beta or dev, never stable.
  The development tag without a valid pin, or with mixed production/development
  pins, does not enable source eligibility.
- The development certificate must have the exact DEVELOPMENT ONLY subject,
  Code Signing EKU, a private key and current validity. Production signing and
  production runtime verification explicitly reject this development subject.
- SignTool is located on PATH or in versioned installed Windows SDK x64 directories;
  it must itself have a valid Microsoft signature before it is executed. No download
  or unsigned fallback occurs. Both EXEs and MSI are verified after signing, with
  signature status and signer SHA256 checked. Hashes/sizes are computed afterward.
- Development timestamps are optional (HTTPS RFC3161 if supplied); without one,
  expiration prevents future validation, including rollback. Production timestamps
  remain mandatory. Do not test across certificate expiry.
- The MSI manifest still says `updater_qualified=false` because a build is not a
  native qualification result. `development_update_build=true` records explicit
  development eligibility only. The build verifies both embedded trust reports.

`Operational()` still requires Windows amd64, the actual LocalSystem Agent
service process, fixed known-folder paths, protected file/directory ownership and
ACLs including ancestors, no unsafe reparse/hardlinked files, valid fixed HTTPS
configuration, valid pinned signatures on BOTH installed executables, matching
Agent/updater trust mode/pins, compatible updater version and protocol, running
fixed automatic LocalSystem services, verified process paths/tokens, protected
service ACLs, bounded recovery restart configuration, safe writable journal storage,
no exhausted rollback, no shutdown and no SentinelGrid MSI maintenance. Any failure
keeps capability false and logs the named failed check. ACL/signature diagnostics
surface only allowlisted static reasons, never raw credential-bearing subprocess output.

The diagnostic observer must be elevated. It invokes the same native readiness
checks, but verifies the real service PIDs and SYSTEM tokens instead of requiring
its own administrator CLI process to be the Agent service. It never stages or
requests an update, stops a service, changes release policy, clears the journal or
removes backups. It may securely create the update directory/lock and write/remove
a fixed diagnostic probe file to test durable storage. Lock availability and journal
status are diagnostics, not permission to perform a concurrent update. A failure
identifies the first failed dependent native check; fix that and rerun.

The development gate is wired through scheduling, handoff, updater recovery,
heartbeat health, terminal reporting, shutdown and MSI coordination. Recovery also
verifies its own fixed SYSTEM service identity and signed updater image. Development
candidates must retain compatible embedded trust and use beta/dev releases; rollback
continues to require a signed previous Agent under the same explicit pin.

### Administrator commands (64-bit Windows PowerShell, repository root)

Install/use approved Go, WiX and Windows SDK Signing Tools yourself if missing. If
Go/WiX are installed in their normal locations but not on PATH, for this session:

~~~powershell
$env:Path = "C:\Program Files\Go\bin;$env:USERPROFILE\.dotnet\tools;$env:Path"
.\scripts\setup-dev-code-signing.ps1 -SetUserEnvironment
~~~

The helper reuses one matching LocalMachine certificate (ambiguous, expired or
exportable existing keys fail rather than silently rotating). New keys are RSA 3072,
SHA256, non-exportable CNG keys valid for six months. Only public bytes are added to
LocalMachine Root and TrustedPublisher. It prints the store SHA1 thumbprint,
SHA256 leaf fingerprint, store path and expiry, and sets only development-specific
variables for this PowerShell process and optionally the current Windows user.
No certificate/private-key files are written. Never run this helper on production.

Build baseline and target from this same source with the SAME development signer:

~~~powershell
.\scripts\build-agent.ps1 -Version 0.1.5 -Channel beta -DevSign
.\scripts\build-agent.ps1 -Version 0.1.6 -Channel beta -DevSign
~~~

`agent\VERSION` now defaults to 0.1.6; explicit `-Version 0.1.5` remains
supported for the baseline. Existing dist version directories are never overwritten.
Archive existing unsigned/failed outputs deliberately before rebuilding. Expected
0.1.6 output is `dist\agent\0.1.6\` with SentinelGridAgent.exe,
SentinelGridUpdater.exe, SentinelGridAgent-0.1.6.msi, manifest.json and checksums.txt.
A failed build's incomplete directory is not a release; only a successful build's
final verified manifest/checksums may be used.

Verify all three target signatures and the exact pin (repeat for 0.1.5):

~~~powershell
. .\scripts\agent-signing-common.ps1
$expected = $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256
if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Explicit development pin required' }
foreach ($name in @('SentinelGridAgent.exe','SentinelGridUpdater.exe','SentinelGridAgent-0.1.6.msi')) {
    $path = Join-Path .\dist\agent\0.1.6 $name
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw "Invalid signature: $name" }
    if ((Get-SignerSHA256 $signature.SignerCertificate) -ne $expected) { throw "Wrong signer: $name" }
    Write-Host "$name : Valid, expected DEVELOPMENT signer"
}
~~~

If build and test machines differ, do NOT generate a second certificate on the test
machine and expect its pin to match. Transfer only the build certificate's PUBLIC
bytes outside the repository, verify its SHA256 against the independently recorded
build fingerprint, then explicitly trust those public bytes in the test machine's
LocalMachine Root and TrustedPublisher. The private key stays on the build machine.
The readiness script accepts `-ExpectedSignerSHA256 '<recorded SHA256>'` so it
never needs a private key or build-user environment on the target.

**Unsigned installed 0.1.5 cannot bootstrap this path.** Build and manually install
signed development 0.1.5 first on a clean disposable VM/snapshot through the existing
MSI enrollment flow; validate retained configuration if using an approved repair
procedure on an already-enrolled test installation. Do not blindly install a second
same-version MSI side-by-side: same-version ProductCode/repair semantics are not
qualified here. Do not manually patch production binaries or disable signature
checks to avoid this baseline step. The 0.1.5 Updater stays installed during the
EXE-only 0.1.6 automatic update; compatible patch-version drift is intentional.

After manually installing the signed baseline and observing authenticated 0.1.5
heartbeats, run on the test machine:

~~~powershell
.\scripts\test-agent-update-readiness.ps1 -ExpectedSignerSHA256 $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256
~~~

The script shows paths, signed versions, signature states, certificate and embedded
pins, source eligibility, both service states, safe state-file metadata, native
journal/lock diagnostics and the Operational result. It prints AUTO-UPDATE READY
only when the actual native probe succeeds; otherwise AUTO-UPDATE NOT READY and
nonzero exit. Readiness is transient, not a permanent machine/fleet qualification.
Inventory currently refreshes every 30 minutes, so after service startup races allow
a refresh before expecting Device View capability to change. Dispatch rechecks
Operational even when inventory is cached.

### Manual release preparation and blockers

The reviewed check API selects semantic versions from active Windows amd64 releases
in the effective organization channel. A beta 0.1.6 is selected for beta 0.1.5, not
stable, same-version or newer Agents. It uses organization_agent_update_settings
(automatic_updates, channel, update_delay_hours), device_agent_update_state and
capabilities. organization_remote_access_settings additionally governs the typed
remote action. The server kill switch and live capability gate download issuance.
Agent credentials, not enrollment tokens, authenticate check/report calls. Only a
private-bucket HTTPS signed URL is issued; the Agent refuses redirects and verifies
final size/hash/signature/pin. No URL/token is persisted in the update journal.

This checkout has NO supabase migration directory or SQL definitions for the named
update RPCs/tables. Obtain and review the actual deployed/test schema before publishing;
do not assume earlier documentation proves migrations exist or were applied. Verify
claim_agent_update_check, report_agent_update and report_agent_update_transaction,
transaction receipts, command/audit completion, RLS/roles, organization isolation,
private agent-releases bucket permissions and idempotent terminal reporting in a TEST
Supabase project. No DB changes were applied by this work.

Only after the signed baseline passes readiness and these test-backend prerequisites
are verified, manually upload final signed Agent bytes to the private bucket at
`beta/0.1.6/SentinelGridAgent.exe`. Use the final manifest's Agent SHA256 and
size, set the test organization beta/zero delay/automatic policy, and enable
`SENTINELGRID_AGENT_UPDATES_ENABLED=true` only in the isolated test deployment.
Keep production/fleet switches off. Local readiness does not validate backend policy.
Use the existing empty-payload Update Agent action (authorized AAL2 owner/admin) or
the scheduler. Startup checks occur after 1-4 minutes, subject to the persisted
5-7 hour schedule; readiness does not reset it. Success requires the authenticated
0.1.6 health marker and 60 seconds of stable runtime within three minutes; terminal
command completion is retried after restart via the transaction RPC. Test rollback,
failed-version persistence, crash/reboot boundaries, shutdown and concurrent MSI
from snapshots before treating this path as qualified. Publishing and triggering
are deliberately separate manual operations.

### Development-path validation commands

~~~powershell
Push-Location agent
gofmt -w .
go test ./...
go vet ./...
go test -tags sentinelgrid_dev_update ./...
go vet -tags sentinelgrid_dev_update ./...
Pop-Location
.\scripts\test-agent-dev-signing.ps1
node --test scripts\test-agent-update.mjs
node node_modules\typescript\bin\tsc --noEmit
node node_modules\eslint\bin\eslint.js scripts\test-agent-update.mjs
npm run build
git diff --check
~~~

Native Go suites include real Windows file pinning/journal/lock tests and unsigned
Authenticode rejection in both trust modes. The nine PowerShell mode tests reject
unsafe flag combinations before any certificate, build output or installed state
is touched. These are NOT substitutes for actual trusted signed-artifact, SCM/MSI
lifecycle or power-loss qualification. No production gate was enabled.

### Results from this development-path session

Passed: Windows gofmt/tests/vet in default and development-tag configurations;
native builds of Agent and Updater in both configurations; build-info/version/
protocol CLI checks; production diagnostic rejection; WiX 7 MSI XML and absolute-
output build with temporary unsigned inputs; eight Node update tests; TypeScript
noEmit; focused ESLint; npm build; PowerShell syntax; nine build-mode rejection
tests; git diff --check. The npm build retains existing metadataBase and MSI-download
prerender warnings. Temporary native validation outputs were removed.

SignTool is unavailable in PATH and the installed SDK locations. This tool session
is not elevated: the installed readiness script correctly refused execution at its
administrator requirement. Development certificate creation/reuse/trust, all three
real signed artifacts, positive installed readiness, SCM/MSI lifecycle, reboot/
power-loss/rollback and Supabase RPC/RLS behavior remain UNVERIFIED. Installed EXEs
were independently inspected as NotSigned; neither service was modified. No signed
release artifacts were generated and no production qualification was enabled.

### Exact files changed for the development qualification path

This list excludes unrelated changes that already existed before this task.

~~~text
agent\VERSION
agent\cmd\sentinelgrid-agent\main.go
agent\cmd\sentinelgrid-updater\main_windows.go
agent\internal\update\checker_other.go
agent\internal\update\checker_windows.go
agent\internal\update\diagnostic_windows.go
agent\internal\update\heartbeat.go
agent\internal\update\host_windows.go
agent\internal\update\maintenance_windows.go
agent\internal\update\qualification.go
agent\internal\update\qualification_development.go
agent\internal\update\qualification_production.go
agent\internal\update\qualification_test.go
agent\internal\update\qualification_windows_test.go
agent\internal\update\readiness_windows.go
agent\internal\update\recovery_windows.go
agent\internal\update\transaction.go
scripts\agent-signing-common.ps1
scripts\build-agent.ps1
scripts\setup-dev-code-signing.ps1
scripts\test-agent-dev-signing.ps1
scripts\test-agent-update-readiness.ps1
scripts\test-agent-update.mjs
docs\agent-build-and-update.md
~~~
