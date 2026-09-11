# Agent build, signing, installer and secure update

## Current qualification

**Auto-update and installer lifecycle are PARTIAL, not production-qualified.**
Production retains `Qualified = false` in `agent\internal\update\transaction.go`.
A certificate, environment variable, server setting or successful build cannot
change that source gate. Development update eligibility is a separate build tag
with an explicit signer pin and the same installed-machine security checks.

The available machine has an unsigned, running 0.1.5 Agent/Updater enrolled against
the existing hosted application. It was not uninstalled, reenrolled or upgraded.
The session is not elevated. The machine-store development certificate has a
missing/inaccessible stored keyset. A separate non-exportable CurrentUser development
key was created and used to sign qualification artifacts. **Its public certificate
is not yet trusted**: Windows reports an untrusted root, not `Valid`. No release
manifest from a successful signed release build, installed positive readiness, real
automatic update, rollback, or MSI lifecycle qualification is claimed.

SignTool is now available from an official Microsoft SDK package extracted under
`dist\tools\signing`. Go/WiX/Node checks, PE/MSI versioning and local isolated database
and transport tests can run without accepting a UAC or certificate-trust dialog.
See `docs\remote-management.md` for the separate native RDP path.

## Build dependencies and commands

Build machine: Windows amd64, PowerShell 5.1+, Go 1.25+, WiX CLI supporting schema
v4 (tested with WiX 7), and Windows SDK SignTool. The pinned `go-winres` Go tool in
`agent\go.mod` generates actual PE version resources; it is not an endpoint runtime
dependency. Customer PCs need none of Go, WiX, SDK, SignTool or Node.

```powershell
# Use installed tools if they are not already on PATH.
$env:Path = "C:\Program Files\Go\bin;$env:USERPROFILE\.dotnet\tools;$env:Path"
# Official Microsoft download, SHA256 and Microsoft signature verification,
# signing-tools-only layout and local administrative extraction. No UAC needed.
.\scripts\setup-agent-signing-tools.ps1

# Unsigned local build only, execution remains unqualified.
.\scripts\build-agent.ps1 -Version 0.1.6 -Dev

# Default production signing: fails unless all signing/trust prerequisites pass.
.\scripts\build-agent.ps1 -Version 0.1.6 -Channel stable -Sign
```

`Find-SignTool` checks PATH, installed Windows SDK locations and the repository's
verified SDK extraction. It refuses an executable without a valid Microsoft
Authenticode signature. Only the explicit setup script downloads SDK files; the
release builder does not silently download/install dependencies.

`agent\VERSION` defaults to `0.1.6`. `-Version` controls inventory/heartbeat, executable
`-version`, PE file/product versions, MSI version and manifest. Versions are numeric
`major.minor.patch` within MSI limits `255.255.65535`; channels are separate release
rings. The update comparator also supports semantic prerelease precedence and ignores
build metadata, but the MSI build refuses suffixes rather than dropping them.

The builder runs gofmt/tests/vet, ordinary plus development-tag checks where relevant,
creates version resources, builds Agent/Updater/operator RDP client, checks reported
and PE versions, signs/verifies each executable and MSI, and only then writes hashes
and the manifest. Generated resource files are removed in `finally`. A build lock
prevents concurrent writes; pre-existing resource/output files are never silently
overwritten. Archive partial or obsolete output directories deliberately before
reusing a version. No artifacts are copied into `public\downloads`, Storage, or an
installed directory, and no release is activated.

A successful build produces:

```text
dist\agent\0.1.6\
  SentinelGridAgent.exe
  SentinelGridUpdater.exe
  SentinelGridRDP.exe
  SentinelGridAgent-0.1.6.msi
  manifest.json
  checksums.txt
```

The RDP connector belongs on the operator PC, not in the endpoint MSI. The manifest
records hashes of final signed bytes, signing mode and pins, not credentials or a
claim of installed readiness. `updater_qualified` remains false.

## Production and development signing

Production uses an existing currently valid Code Signing certificate with an
accessible store/HSM key and an explicitly configured SHA256 leaf-certificate pin:

```powershell
$env:SENTINELGRID_SIGN_CERT_THUMBPRINT = '<40-hex-store-thumbprint>'
$env:SENTINELGRID_UPDATE_SIGNER_SHA256 = '<64-hex-leaf-certificate-SHA256>'
$env:SENTINELGRID_SIGN_TIMESTAMP_URL = 'https://<approved-RFC3161-service>'
.\scripts\build-agent.ps1 -Version 0.1.6 -Channel stable -Sign
# Add -CertificateStore LocalMachine when appropriate.
```

The SHA1 thumbprint selects the certificate; it is not the artifact hash or runtime
trust pin. Production requires an HTTPS RFC3161 timestamp. The development subject
is rejected in production by both signing and runtime verification. No private-key
file/password is accepted by the build script or committed to the repository.

On an **elevated designated development/test machine**:

```powershell
.\scripts\setup-dev-code-signing.ps1 -SetUserEnvironment
.\scripts\build-agent.ps1 -Version 0.1.5 -Channel beta -DevSign
.\scripts\build-agent.ps1 -Version 0.1.6 -Channel beta -DevSign
```

The helper reuses exactly one suitable development certificate or creates a six-month
RSA-3072 Code Signing certificate with a non-exportable CNG key. It tests actual key
access and trusts only the certificate's public bytes. Ambiguous, invalid or missing
existing keys are not silently replaced. Resolve the old machine-store key issue
explicitly, or select the available development signer in CurrentUser.

`-CertificateStore CurrentUser` on the setup helper, and `-DevCertificateStore
CurrentUser` on the builder, support a non-elevated build key. They **do not establish
SYSTEM or other-machine trust**. CurrentUser root import may require an interactive
Windows security confirmation. Do not suppress trust verification to work around it.
For the signer created during this session, only public bytes were exported to
`dist\tools\SentinelGrid-development-public.cer`; the private key remains in the store.
An elevated administrator on the designated test machine may inspect the independent
SHA256 fingerprint and import these public bytes into LocalMachine Root and
TrustedPublisher. Do not generate a different certificate and expect pins to match.

`-DevSign` requires beta/dev, exactly one development SHA256 pin, and cannot combine
with `-Sign`, `-Dev` or `-SkipMSI`. The development timestamp is optional; without one,
certificate expiry also invalidates rollback. Both Agent and Updater must embed the
same development trust. Production ignores development pins and remains unqualified.

For every executable and MSI, `signtool verify /pa /all` and
`Get-AuthenticodeSignature` must pass with the expected leaf fingerprint before
publication. The build does this automatically. An attached signature with an
untrusted root is **not** an acceptable release. The unqualified signed artifacts
under `dist\qualification` are investigation outputs, not publishable releases.

## Installer behavior and compatibility

The UpgradeCode `B632A689-8C9E-4E77-BF7C-5E9C4A012901`, fixed Program Files directory,
component identities, SYSTEM service names and ProgramData identity/config path are
preserved. Both services are automatic own-process services. MSI installs bounded
recovery actions for the updater: two one-minute restarts, then no action.

A concrete upgrade hazard was missing executable version resources: Go's `-version`
output is not PE version information, and MSI applies different replacement rules
to unversioned/modified files. Builds now embed actual matching PE versions before
signing. MSI does not pretend unversioned files have a version via `DefaultVersion`.
The MSI blocks downgrades and second products of the same version while allowing
repair with the installed product. It cannot establish compatibility with arbitrary
legacy packages that use a different UpgradeCode; inventory those separately.

Fresh installation retains the `SentinelGridAgent__SG-ENROLL-<token>.msi` filename
contract. Enrollment now runs synchronously as a checked deferred SYSTEM action,
not `asyncNoWait`: failures surface to MSI instead of returning success while
unenrolled. For isolated tests, pass `SENTINELGRID_SERVER=https://<test-origin>`;
non-HTTPS origins, credentials, paths, queries and fragments are rejected. The
default production enrollment URL is unchanged, so do not run test enrollment
without an explicitly designated test server/token.

Major upgrades and reinstalls with an existing configuration skip enrollment and
validate the preserved configuration before service start. Configuration writes
require elevation/SYSTEM, a fixed protected directory, trusted ownership and no
reparse ancestors. New config writes use an atomic, write-through replacement after
protecting the directory's DACL to SYSTEM/Administrators. Config/identity is retained
on uninstall for deliberate reinstall; deleting it is an explicit decommissioning
operation, not an update step. Existing unsafe ownership is rejected for reviewed
administrator repair rather than silently adopted.

The MSI uses `afterInstallExecute` major-upgrade sequencing to retain old components
for rollback. Maintenance coordination takes the same update lock, rejects active
transactions, writes a durable maintenance marker and quiesces recovery before file
changes. Commit/rollback clears the marker and restores recovery. Interrupted MSI
maintenance fails closed until repair. Actual clean install, same-package repair,
older-version upgrade, uninstall/reinstall and failure rollback still require an
elevated isolated Windows endpoint; MSI compilation/table inspection are not those
tests.

## Backend and release publication

Checked-in migrations, in order:

1. `202609110001_remote_management_foundation.sql`
2. `202609110002_rdp.sql`
3. `202609110003_agent_build_and_update.sql`

They assume the application's baseline organizations, organization members, clients,
devices, audit logs, Supabase auth and Storage schemas. They are exercised with real
PostgreSQL semantics through PGlite test fixtures. Read-only inspection found the
configured hosted backend already has update tables/RPCs; it lacks `rdp_sessions`.
Existing update column/RPC names were used rather than inventing a second schema.
**No hosted migration was applied.** Review pre-existing policies/constraints and
migration history on a designated test project before applying/reconciling these
restored definitions. Passing local fixture tests is not hosted Supabase qualification.

The update migration provides release metadata, organization policy, per-device
state/rate claims and durable transaction/typed-command receipts. Mutation and report
RPCs are service-role only. RLS binds device-state reads to the device's current
organization. The `agent-releases` bucket is private; restrictive object policies
exclude it even from pre-existing broad authenticated/anonymous storage policies.
Only trusted backend/admin infrastructure can upload/activate releases. Review
storage policies and anonymous access again on the actual test backend.

The check API authenticates the Agent's token hash and derives device/organization
from the database. It selects the highest eligible Windows/amd64 version in the
organization ring after publication delay. Missing policy means stable, automatic
updates enabled and zero delay, but the separate backend switch defaults off.
Only `SENTINELGRID_AGENT_UPDATES_ENABLED=true` **and** installed capability allow a
15-minute signed HTTPS Storage URL. Hash, byte size, product, version, ring and expiry
are validated locally; redirects and arbitrary user-supplied update URLs are refused.

The report API bounds/parses JSON, accepts allowlisted states/errors only and does
not accept URLs, commands, paths or organization IDs. Transactions bind device,
target and optional update command; terminal receipts and command/audit completion
are atomic and idempotent. Success requires a target-version heartbeat already in
device inventory. Check claims are limited to one/minute; changed transaction
reports are bounded to 20/minute and duplicate receipts are acknowledged without
repeating side effects. These reports are evidence from the authenticated Agent,
not independent cryptographic attestation of a remote device.

Publication remains a separate approved operation: upload **verified final** Agent
bytes to `beta/0.1.6/SentinelGridAgent.exe` in private Storage, create matching inactive
metadata (hash/size/path/version), independently verify the download, and activate
only for a designated beta test organization. Versions/artifact metadata are immutable.
No script here uploads releases, changes a production switch or triggers a fleet.

## Local transaction and readiness guarantees

The Agent checks 1-4 minutes after startup, then every 5-7 hours with jitter; its next
check is persisted before network work. A failed/untrusted path never falls back to
an unprotected directory. Background update work remains separate from heartbeat,
metrics, inventory, enrollment and terminal.

Staging is the fixed protected `ProgramData\SentinelGrid\updates` directory. The Agent
holds an exclusive Windows file lock through download, signature/hash validation,
policy recheck and durable handoff. URLs/tokens are not stored in the journal. The
SYSTEM recovery service acquires the same lock, validates the pinned candidate again,
backs up the signed previous Agent, stops the fixed service, atomically replaces the
fixed executable, starts it and requires a fresh authenticated heartbeat from the
expected stable PID/process creation time for at least 60 seconds. Health is bounded
to three minutes, service stop to 60 seconds, and rollback to four minutes.

Failures restore the signed previous executable and require its healthy reconnect.
Restart/shutdown preserves intent; recovery restores rather than blindly retrying a
candidate. Attempts are persisted before rollback, capped at three, and exhausted
recovery preserves backup/journal with `ROLLBACK_FAILED`. Failed-version history
(up to 128 entries without eviction) prevents loops. Terminal reports retry every
30 seconds and must be acknowledged before reusing the transaction. Cleanup removes
only known safe artifacts, never the journal/failure history.

Installed readiness requires source eligibility, Windows amd64, actual SYSTEM
Agent/updater service processes, fixed paths, matching embedded pins/trust, valid
pinned signatures on **both** installed executables, compatible updater major/minor
and protocol `1`, protected file/ancestor/service ACLs, no reparse/hardlinked metadata,
writable durable storage and no shutdown/MSI/exhausted-recovery block. API settings
cannot bypass any of these checks. The helper itself is not replaced by executable
self-update; helper/protocol/pin rotation requires a planned signed MSI deployment.

After installing a signed baseline on an isolated snapshot-backed test endpoint:

```powershell
.\scripts\test-agent-update-readiness.ps1 -ExpectedSignerSHA256 '<independently-recorded-pin>'
```

The diagnostic requires elevation and makes no update. It reports named failures,
service/signature information, journal status and lock availability. Writable-storage
checks may create/remove a diagnostic probe. An unsigned installed 0.1.5 is not a
rollback baseline and cannot bootstrap the normal update; do not install another
same-version MSI alongside it to bypass that requirement.

## Required positive qualification

After trusted signed 0.1.5 baseline readiness and test-backend verification, publish
only the isolated beta target and enable only that deployment's switch. Observe the
scheduler moving 0.1.5 to 0.1.6 without MSI reenrollment, stable service reconnect,
unchanged device/config identity, Device View 0.1.6 and an acknowledged durable
transaction. Exercise wrong hash/signer, URL expiry, concurrent MSI/power action,
failed start/heartbeat, service restart and power loss at each durable phase. Verify
bounded rollback and failed-version suppression. Do not clear state merely to make
a failed release retry. Production source qualification must remain false until
these real Windows lifecycle tests pass and a trusted production signer is available.

```powershell
Push-Location agent
gofmt -w .
go test ./...
go vet ./...
go test -tags sentinelgrid_dev_update ./...
go vet -tags sentinelgrid_dev_update ./...
Pop-Location
node --test scripts\test-agent-update.mjs scripts\test-agent-migrations.mjs scripts\test-rdp-policy.mjs scripts\test-rdp-relay.mjs
.\scripts\test-agent-dev-signing.ps1
node node_modules\typescript\bin\tsc --noEmit
npm run build
node scripts\test-rdp-http.mjs
git diff --check
```
