# Full-product MSI updates (protocol 2)

## Daily release command and signing setup

Use one orchestrator for all channels. Run signing setup explicitly, not for each
release. It never builds, publishes, changes organization policy or enables updates.

```powershell
# Elevated PowerShell for the default LocalMachine Beta certificate/trust store:
.\scripts\setup-signing.ps1 -Profile Beta
# Separate Production certificate, default CurrentUser store:
.\scripts\setup-signing.ps1 -Profile Production

# Daily commands (no setup is called automatically):
.\scripts\release-agent.ps1 -Channel beta
.\scripts\release-agent.ps1 -Channel stable -Version 1.0.0
.\scripts\release-agent.ps1 -Channel dev
# Optional explicit website origin:
.\scripts\release-agent.ps1 -Channel beta -WebsiteURL "https://sentinelgrid-one.vercel.app"
```

| Channel | Signing configuration | Development build | Version policy |
| --- | --- | --- | --- |
| beta | Existing certificate discovered by published beta SHA256 pin; `SENTINELGRID_DEV_UPDATE_SIGNER_SHA256` for bootstrap | true | Explicit, or patch after max(local VERSION, published versions in beta) |
| dev | Explicit development profile; separate organization/channel/artifact paths | true | Explicit, or patch after max(local VERSION, published versions in dev) |
| stable | `SENTINELGRID_SIGN_CERT_THUMBPRINT`, `SENTINELGRID_UPDATE_SIGNER_SHA256` | false | Explicit only, newer than every published stable version |

Versions must be exact `major.minor.patch`, within MSI limits `255.255.65535`.
There are no prerelease suffixes: rings are represented by the channel. Stable
versions are not inferred from beta; an explicit stable version can differ from
the local VERSION left by another ring. Existing same/older channel versions are
rejected. Successful releases update `agent\VERSION` atomically after all remote
checks and confirmed token revocation, under a local release lock.

Beta setup reuses the existing `CN=SentinelGrid DEVELOPMENT ONLY Code Signing`
certificate, or creates it only if neither certificate nor prior signer configuration
exists. Production setup uses a separate `CN=SentinelGrid Code Signing` certificate.
To select an existing CA-issued RSA code-signing certificate, pass
`-CertificateThumbprint <thumbprint> -CertificateStore CurrentUser|LocalMachine`.
Ambiguous certificates, stale configured thumbprints, invalid EKU, missing/private
key access failures, expired/not-yet-valid certificates and pin mismatches abort setup.
Setup never silently replaces a configured pin. Restore existing keys/configuration
rather than accidentally rotating the signer that deployed Agents already trust.

New keys are RSA 3072, SHA256 and non-exportable. Setup verifies a private-key signing
challenge and derives the SHA256 pin from the public certificate. It persists public
identifiers in the current process and Windows User environment by default (opt out
with `-SetUserEnvironment $false`). No `.env` file or secret is written. Other open
terminals retain their old environment. The Beta default is LocalMachine; Production
is CurrentUser. Both support an explicit store. Only explicit setup adds public trust
in the selected scope: TrustedPublisher, and Root for self-signed certificates.

**A self-signed Production certificate is not publicly trusted code signing.** It
requires independently verified public-certificate trust deployment to target
machines, including SYSTEM, before rollout. CurrentUser build-machine trust does
not establish fleet trust. For public distribution, select a suitably trusted
CA-issued certificate. Production requires an HTTPS RFC3161 timestamp endpoint;
setup defaults to `https://timestamp.digicert.com` when none is configured, or accepts
`-TimestampUrl`. Development timestamps remain optional. No TLS/Authenticode/origin
or hash validation is disabled, and signing does not qualify production auto-update.

If Production is missing, stable stops before contacting the backend:

```text
Production signer not configured.
Run:
.\scripts\setup-signing.ps1 -Profile Production
```

### Backend and verification organization

The orchestrator reads backend/website/organization settings from process variables
or read-only `.env.local`; explicit signing settings come from the process environment.
Beta also resolves its existing pin from the latest published beta bundle, as below.
See `.env.example` for placeholders. Explicit backend `SENTINELGRID_PUBLISH_*`
settings take priority. The selected administration key can be a legacy service-role
JWT or a modern `sb_secret_*` key; the latter is not sent as a JWT in PowerShell REST
calls. Configure the intended key explicitly if old settings are stale: authentication
errors are not silently ignored. The backend must be an explicit HTTPS origin.

Website discovery preserves the original beta flow for every channel. It tries
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, then `APP_URL`,
skipping ineligible values such as `http://localhost:3000` without upgrading HTTP to
HTTPS. Eligible HTTPS URLs are reduced to their origin, as in the original
`Convert-ToHttpsOrigin`; credentials, query strings and fragments are rejected.
If none qualify, it reads `Server`, `server`, `ServerURL`, `server_url` or `serverUrl`
from `ProgramData\SentinelGrid\agent.json` (normally
`C:\ProgramData\SentinelGrid\agent.json`). Missing/unusable config falls through;
read/JSON errors emit a warning without printing config contents. The final fallback
is `https://sentinelgrid-one.vercel.app`. No per-release environment setup is needed.
Optional `-WebsiteURL` overrides discovery and must be an HTTPS origin without a
path, credentials, query or fragment; an invalid override fails instead of falling
back. The resolved origin is passed unchanged to build and publisher. The orchestrator
sets `SENTINELGRID_PUBLISH_WEBSITE_URL` for the low-level publisher, not for discovery.

Set `SENTINELGRID_RELEASE_BETA_ORGANIZATION_ID`,
`SENTINELGRID_RELEASE_STABLE_ORGANIZATION_ID` and
`SENTINELGRID_RELEASE_DEV_ORGANIZATION_ID` for deterministic verification contexts,
or pass `-OrganizationId`. An explicitly selected organization with the wrong
effective channel fails without trying another organization. Without a configured
ID, discovery is limited to the requested effective channel and requires an existing
real client and owner. Missing organization settings mean stable, exactly as on the
website; beta/dev require their explicit policy. No policy, clients, owners or device
relationships are created/changed by the release command.

The same build and publisher are used for all three rings:

```text
release-agent.ps1
  resolve channel / explicit signing profile for stable or dev
  resolve verification organization / real client / owner
  read latest channel bundle; discover existing beta certificate by its pin
  verify signer continuity and determine version
  build-agent.ps1 (or fully validate and reuse existing artifacts)
  recheck organization and create a 30-minute temporary enrollment token
  publish-agent.mjs
    verify local signatures, versions, hashes and MSI trust metadata
    upload immutable channel/version objects and download/verify every object
    validate the complete downloaded bundle with Windows Authenticode
    publish_agent_release
    verify agent_release_channels + agent_releases + agent_release_bundles
    real /api/agent/download redirect, filename, origin and MSI validation
    recheck organization/token and channel DB state; write a receipt
  revoke token in finally, requiring backend confirmation
  restore previous process environment
  update agent/VERSION only after success
```

The token intentionally remains **after the expensive build**, as in the old beta
flow, rather than expiring during native compilation. Token revocation is attempted
even when creation may have committed but its response was lost. Revocation failure
is an error, not a successful release with a warning. Tokens/keys/signed URLs are not
printed. A hard process termination can prevent cleanup; the token still expires.

### Migration and interrupted publication

`release-beta.ps1` remains a deprecated, thin wrapper around
`release-agent.ps1 -Channel beta`, including its `-OrganizationId` parameter.
`setup-dev-code-signing.ps1` similarly delegates to Beta setup and retains its old
opt-in User-environment persistence. There is no second release implementation.
Beta reuses the existing private certificate by SHA256, searching `CurrentUser\My`
then `LocalMachine\My`, as the original beta script did. The latest published beta
bundle's pin is authoritative; `SENTINELGRID_DEV_UPDATE_SIGNER_SHA256` is used only
when no beta release exists. Stale DEV pin/thumbprint values produce a warning and
are not persisted or rotated. No configured thumbprint/store is required for beta
discovery. Missing matching private keys, invalid EKU, certificate validity failures
or invalid published signer/profile metadata abort; setup is not invoked.

Publication never reads or executes the installed Agent executable. Its presence,
channel, Authenticode state and update eligibility are not publication prerequisites.
Only its optional JSON config is consulted as a website discovery fallback.
Stable still requires its explicit, separate PROD signer and validates the new
Agent, Updater, RDP, native video DLL and MSI with valid Authenticode and the PROD
SHA256 pin. Manifest, embedded Agent/Updater trust and MSI must agree on
`development_update_build=false`. Installed beta/dev -> stable is a separate VM
lifecycle exercise, not a release preflight; publication does not qualify upgrades.

Replace old scheduled/manual commands with `release-agent.ps1 -Channel beta`.
The original website discovery/default remains available; `-WebsiteURL` is optional.
Configure a verification organization if the old script relied on its hardcoded
preferred organization. Never replace the development signer just to migrate the
wrapper. `build-agent.ps1 -Publish` now fails with migration guidance: use the
orchestrator for publication. Direct build-only commands and development repair
builds remain available.

New build artifacts live at `dist\agent\<channel>\<version>`. A valid legacy bundle
at `dist\agent\<version>` can still be reused only for its exact channel, version,
origin, development profile and pins, after full local validation. Other-channel
artifacts are never promoted/copied as a release. Incomplete or invalid local builds
are retained and require deliberate archiving; no stale resources are deleted by
the orchestrator. Build and release locks prevent competing local operations.

Storage uploads use `upsert: false`. An interrupted pre-commit upload may resume only
when existing bytes match exactly. Published releases cannot be overwritten or
recommitted, even if subsequent website validation fails. A failure after the RPC
may mean the channel is already live: inspect the channel and evidence under
`dist\validation\publish-<channel>-<version>-<uuid>` before retrying. A success receipt
is written only after website and final DB verification; token revocation is then
confirmed by the orchestrator. Failed releases leave VERSION unchanged and retain
artifacts/evidence. Do not delete remote releases to force a retry or rollback; use
an explicit newer release after resolving the failure.

No SQL, migrations, RLS or API effective-channel policy changes are required by this
refactor. The existing schema includes `agent_release_bundles` for product metadata;
these fields do not belong to `agent_releases`. The SQL files referenced by the
migration test are absent from this checkout, so hosted RPC/RLS immutability cannot
be qualified here. Do not interpret local mocked DB checks as hosted SQL proof.

## Scope and qualification

Auto Update and the dashboard's **Update Agent** command use the same Go
`WindowsHost.InstallRelease` policy/download/handoff engine. The scheduler supplies
an empty command ID; Force Update supplies the existing command UUID. Neither
trigger can select a URL, executable, signer, organization or downgrade policy.
Both continue to respect the server-derived effective channel and release delay;
a stable organization does not receive beta, nor beta stable.

The MSI contains Agent, Updater, RDP and the native video DLL with one release
version. Executable `-version` output, PE resources, manifest entries and MSI
File/Product versions must agree before publication. Individual EXEs remain
diagnostic/build artifacts, not remote installation payloads. RDP is unchanged.

This is not production lifecycle qualification. `Qualified = false` remains in
place. Development builds use the existing tag and embedded pin, only in beta/dev.
A VM lifecycle qualification with signed N -> N+1 -> N+2 is required before
production enablement. MSI upgrades intentionally restart services: **zero
interruption of an individual Agent/Terminal session cannot be guaranteed**.
Schedule rollout outside active remote sessions; do not force fleet reconnections.

## Shared update engine and security

1. Authenticate to the existing check API; select the latest eligible channel/version
   from server inventory and organization policy, including the release delay.
1. Negotiate protocol 2. The API verifies the stored manifest SHA256 and its full
   product metadata, then issues a short-lived private Storage URL for the MSI.
   Existing database EXE metadata stays for schema compatibility; MSI hash/size and
   manifest/signer fields already used by `publish_agent_release` are reused.
1. Persist `downloading` with transaction and optional command ID. Download over
   HTTPS without redirects. Verify exact size, SHA256, Authenticode and the
   build-embedded signer pin; the API cannot expand the trust allowlist.
1. Check the signed MSI's product, UpgradeCode, architecture, protocol, channel,
   development trust and all payload versions. Recheck server policy after download.
1. Persist `staged`. Require the existing backend transaction receipt before marking
   the handoff authorized. The Updater re-verifies the MSI before installation.
1. Record previous Agent process identity and a hash of the existing `agent.json`.
   Persist `installing` before launching a fixed Windows PowerShell coordinator.
   It waits for a durable PID/creation-time acknowledgement, pins and re-verifies
   the MSI, then runs the fixed system `msiexec /i ... /qn /norestart`.
1. The coordinator is an OS executable, not a copied Updater. It outlives the
   service stop, and has no network input or arbitrary execution options. Windows
   Installer stops/replaces/starts Agent and Updater and installs RDP. No updater
   executable copies, self-deletion or EXE rollback are used for protocol 2.
1. MSI maintenance actions record commit/rollback evidence; the coordinator records
   the actual exit code atomically. Only codes 0 and 3010 can enter `awaiting_health`.
1. Verify all three installed signed binaries against the target, unchanged config,
   matching Agent/Updater build trust, and an authenticated heartbeat from a new
   Agent process. The running Updater itself must also match the target. Require an
   authenticated heartbeat for this transaction and the existing one-minute stable-process
   interval. Only then persist/report `succeeded` through the existing HTTP receipt.

On the validation host, WiX sometimes materialized only the long output filename's
8.3 alias. The build authors `package.msi` and renames that known build output
to `SentinelGridAgent.msi` **before** signing and hashing; it never accepts an
unexpected artifact name or changes already-published bytes.

## Journal, failure and recovery

State remains in `C:\ProgramData\SentinelGrid\updates\state.json`, protected by
existing SYSTEM/Administrators ACLs, atomic write-through replacement and the
existing exclusive update lock. MSI metadata contains no URL or AgentToken.
`agent.json` is not an MSI component, is not deleted on upgrade/uninstall, and the
existing enrollment/config validation conditions remain in place.

- A downloading crash becomes failed without stopping the old Agent. An authorized,
  unexpired staged MSI can resume after an Updater restart; it is always reverified.
- An acknowledged running coordinator is observed, never relaunched. A restarted
  Updater reads its result and resumes health confirmation. Windows Installer owns
  installation rollback; the old single-EXE restore code is only for legacy journals.
- Failed MSI exit codes remain failed. The raw code is persisted in `state.json` at
  `msi.exit_code` and sent to the report API, which logs it with device/transaction/
  command IDs after accepting the existing transaction RPC. SQL error enums remain
  unchanged (`INSTALL_OR_HEALTH_FAILED`); the richer code is **not a new DB column**.
- 3010 means reboot required, not success. No forced reboot is issued. Health can
  resume after reboot for up to 24 hours; failure to prove the whole target product
  leaves the transaction failed and requiring repair.
- If the coordinator dies/reboots without a durable exit result, do not infer
  success from files or an MSI commit action alone. Record an unknown-result failure,
  retain evidence, block another automatic installation, and require administrator
  MSI repair. An Installer process may still be completing rollback; let it finish.
- Repair uses the signed target MSI with Windows Installer, never manual EXE copy.
  A successful protocol-2 maintenance commit clears the repair interlock only after
  verifying aligned binaries and unchanged configuration. The original failed
  transaction stays failed; manual repair does not fabricate update success.
- Never delete `state.json`, `maintenance.json`, locks or backups to force an update.
  Terminal reports retry until acknowledged; staged receipt and command correlation
  remain mandatory. No global queue, realtime or Redis delivery changes are required.

Local `awaiting_health` maps to the existing backend `restarting` status if reported;
terminal receipt semantics and existing SQL status/error enums are preserved.

## Compatibility, bootstrap and rollout rollback

Protocol-1 Agents/Updaters (including Agent 0.1.8 + Updater 0.1.5) cannot safely
self-bootstrap by receiving an MSI as `candidate.exe`. The check API returns
`installation_enabled: false`, `bootstrap_required: true` and no download URL for
old clients. Existing monitoring and remote commands remain available; legacy
remote updates are intentionally blocked until bootstrap. Let any in-flight legacy
transaction finish before maintenance. New Updater code retains legacy journal
recovery, not a second pipeline for new releases.

Install one **newer**, signed protocol-2 MSI manually on each legacy endpoint, using
the existing enrolled config. No new enrollment token is needed on that device.
Do not use an old same-version package to introduce protocol 2; publication/version
checks intentionally reject equal versions and downgrades. Verify the existing
signer independently before invoking Windows Installer.

Deploy the compatible API and publish a qualified signed protocol-2 release before
rolling out the bootstrap MSI to a canary. Keep the previous signed MSI/release
artifacts and backups available for administrator-led recovery. To pause a rollout,
turn off the existing server installation flag or organization automatic policy.
This blocks new authorizations, not an MSI already executing. Do not downgrade EXEs,
revert the Updater alone, remove enrollment config, or stop an active installer.
Rolling the API back makes new Agents reject EXE responses rather than installing
partial updates. It does not migrate protocol-2 journals back to protocol 1.

## Manual qualification in an isolated enrolled Windows VM

Use existing signing configuration. Do not run these installation commands on a
production endpoint as a substitute for qualification. Take a VM snapshot first.
Build/publish with the shared release flow (no changes to `.env.local`):

```powershell
.\scripts\release-agent.ps1 -Channel beta
# Or build only, using the already configured development signer:
.\scripts\build-agent.ps1 -Version <N> -Channel beta -DevSign
```

After independently checking signature/pin/hash and validating the signed release,
bootstrap the enrolled VM with an MSI version newer than its installed product:

```powershell
$before = (Get-FileHash 'C:\ProgramData\SentinelGrid\agent.json' -Algorithm SHA256).Hash
$p = Start-Process "$env:SystemRoot\System32\msiexec.exe" -ArgumentList '/i "C:\Releases\N\SentinelGridAgent.msi" /qn /norestart' -Wait -PassThru
if ($p.ExitCode -notin 0,3010) { throw "MSI failed: $($p.ExitCode)" }
# Reboot the test VM if code 3010 is returned, then continue.
.\scripts\test-agent-update-readiness.ps1 -ExpectedSignerSHA256 <existing-trusted-pin>
```

Publish N+1 with organization `automatic_updates` enabled and the beta channel.
**Do not click Force Update.** Restart the Agent and let its normal scheduler run:

```powershell
Restart-Service SentinelGridAgent
```

The initial timer remains 1-4 minutes; an existing persisted `schedule.json` deadline
is still respected. Subsequent checks remain 5-7 hours. Do not delete the schedule
or add a polling bypass to make a test appear successful. Allow policy release-delay
hours as well. Inspect the journal without printing `agent.json` or credentials:

```powershell
$s = Get-Content 'C:\ProgramData\SentinelGrid\updates\state.json' -Raw | ConvertFrom-Json
$s | Select-Object update_status,update_target_version,transaction_id,command_id,update_error
$s.msi | Select-Object exit_code,detail,repair_required
& 'C:\Program Files\SentinelGrid\SentinelGridAgent.exe' -version
& 'C:\Program Files\SentinelGrid\SentinelGridUpdater.exe' -version
& 'C:\Program Files\SentinelGrid\SentinelGridRDP.exe' -version
& 'C:\Program Files\SentinelGrid\SentinelGridUpdater.exe' -protocol
Get-Service SentinelGridAgent,SentinelGridUpdater
if ((Get-FileHash 'C:\ProgramData\SentinelGrid\agent.json' -Algorithm SHA256).Hash -ne $before) { throw 'Enrollment config changed' }
```

Require all three versions N+1, protocol `2`, both services running, an authenticated
heartbeat at N+1, `succeeded`, empty command ID, and backend receipt. Then publish
N+2, trigger **Update Agent** in the dashboard, and require the same evidence at
N+2 with its actual command UUID and succeeded command. Also exercise installation
failure, MSI rollback, reboot, Updater stop/restart and missing-result recovery in
VM snapshots. A missing/unsigned/tampered/unqualified MSI must never start msiexec.

For an ambiguous failed installation, wait for Windows Installer to finish and use
an independently verified signed target package for repair in the VM:

```powershell
$p = Start-Process "$env:SystemRoot\System32\msiexec.exe" -ArgumentList '/fvamus "C:\Releases\Target\SentinelGridAgent.msi" /qn /norestart' -Wait -PassThru
if ($p.ExitCode -notin 0,3010) { throw "Repair failed: $($p.ExitCode)" }
# Repeat version/config/readiness checks; do not rewrite the failed transaction.
```

If the target product was never registered, install that newer target with `/i`
instead of attempting repair of an unregistered ProductCode. Windows Installer
must decide applicability; do not bypass downgrade or same-version guards.

## Local checks (no installation/publication)

```powershell
.\scripts\test-agent-release.ps1
.\scripts\test-agent-dev-signing.ps1
node --test scripts\test-product-update.mjs scripts\test-product-update-api.mjs scripts\test-agent-update.mjs scripts\test-agent-publication.mjs scripts\test-agent-delivery.mjs scripts\test-update-command-feedback.mjs
npx tsc --noEmit
Push-Location agent
go test ./...
go vet ./...
go test -tags sentinelgrid_dev_update ./...
go vet -tags sentinelgrid_dev_update ./...
Pop-Location
.\scripts\test-agent-msi.ps1 -BaselineMSI <N-msi> -TargetMSI <N-plus-1-msi>
```

The release tests cover channel selection, certificate identity/EKU/private key/time
and pin rejection, beta certificate discovery in both stores without a configured
thumbprint, published-pin precedence over stale environment values, publication
without inspecting the installed Agent executable, website candidate priority and
localhost rejection, config/default fallbacks, explicit website overrides and origin
propagation to build/publisher, MSI version bounds, token cleanup,
environment restoration, failures before/after publication, VERSION persistence and
lock release. They mock external release boundaries and use in-memory certificates,
not live credentials. Publication tests verify immutable upload ordering and exact
DB/channel/bundle checks.
The Go tests cover durable MSI phases, shared automatic/command handoff, bad hash/
signature, policy expiry, downgrade/equal-version rejection, failed installation,
health interlocks, config/journal preservation and restart without relaunch. Native
PowerShell syntax/Authenticode checks do not install anything. Signed-release tests
are opt-in via `SENTINELGRID_TEST_ARTIFACT_DIRECTORY` and an independently supplied
`SENTINELGRID_TEST_SIGNER_SHA256`; these are test-process settings, not replacements
for existing deployment variables. Mocked health tests are not VM lifecycle proof.
