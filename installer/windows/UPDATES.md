# Full-product MSI updates (protocol 2)

## Scope and qualification

Auto Update and the dashboard's **Update Agent** command use the same Go
`WindowsHost.InstallRelease` policy/download/handoff engine. The scheduler supplies
an empty command ID; Force Update supplies the existing command UUID. Neither
trigger can select a URL, executable, signer, organization or downgrade policy.

The MSI now contains Agent, Updater and RDP with one release version. Their
`-version` output, PE version resources, manifest entries and MSI File/Product
versions must agree before publication. Individual EXEs remain diagnostic/build
artifacts, not remote installation payloads. RDP transport/protocol is unchanged.

This is not production lifecycle qualification. `Qualified = false` remains in
place. The existing signed development build uses the existing development tag,
certificate and embedded pin; it is restricted to beta/dev. No certificate is
created/replaced, no environment file is written, and no TLS check is relaxed.
A VM lifecycle qualification with signed N -> N+1 -> N+2 is required before
production enablement. MSI upgrades intentionally restart services: **zero
interruption of an individual Agent/Terminal session cannot be guaranteed**.
Schedule rollout outside active remote sessions; do not force fleet reconnections.

## Shared pipeline and security

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

The website release/download enrollment flow and temporary enrollment-token
creation/revocation in `scripts\release-beta.ps1` are unchanged. That script calls
the strengthened build/publisher/validator and cannot reuse an old EXE-only
manifest as a protocol-2 release. Reusing a valid immutable build still works.

On the validation host, WiX sometimes materialized only the long output filename's
8.3 alias. The build now authors `package.msi` and renames that known build output
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
terminal receipt semantics and existing SQL status/error enums are preserved. The
SQL migration files referenced by `scripts\test-agent-migrations.mjs` are absent
from this checkout, so those RPC implementations must be restored and tested before
qualifying a hosted rollout. No Supabase migration/RLS/auth changes were made here.

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
Build/publish with the existing release flow (no changes to `.env.local`):

```powershell
.\scripts\release-beta.ps1
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

The Go tests cover durable MSI phases, shared automatic/command handoff, bad hash/
signature, policy expiry, downgrade/equal-version rejection, failed installation,
health interlocks, config/journal preservation and restart without relaunch. Native
PowerShell syntax/Authenticode checks do not install anything. Signed-release tests
are opt-in via `SENTINELGRID_TEST_ARTIFACT_DIRECTORY` and an independently supplied
`SENTINELGRID_TEST_SIGNER_SHA256`; these are test-process settings, not replacements
for existing deployment variables. Mocked health tests are not VM lifecycle proof.
