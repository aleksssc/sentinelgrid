<div align="center">

# 🛡️ SentinelGrid

### Monitor. Detect. Protect.

**SentinelGrid is a modern cybersecurity monitoring and attack-surface management platform built to give organizations a clear view of their external security posture.**

<br>

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge\&logo=nextdotjs\&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge\&logo=typescript\&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge\&logo=tailwindcss\&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge\&logo=supabase\&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge\&logo=postgresql\&logoColor=white)

</div>

---

## ⚡ Overview

SentinelGrid is a SaaS cybersecurity platform designed to help teams **monitor internet-facing assets, identify security issues and react to changes before they become incidents**.

The project is being built with a simple objective:

> **Turn complex security data into clear, actionable information.**

The initial MVP focuses on website and endpoint monitoring while providing the foundation for a much larger security monitoring platform.

---

## ✨ Core Features

### 🌐 Monitoring

Create and manage monitors for websites and internet-facing services.

* HTTP/HTTPS availability monitoring
* Response status tracking
* Monitor health overview
* Historical checks
* Centralized monitoring dashboard

### 🏢 Organizations

SentinelGrid uses an organization-based architecture designed for teams and companies.

* Multiple organizations
* Organization owners
* Members and roles
* Organization settings
* Member management
* Secure invitation system

Users join organizations through invitations instead of directly joining them.

### 👥 Role-Based Access

Organization permissions are structured around different roles:

| Role       | Access                                |
| ---------- | ------------------------------------- |
| **Owner**  | Full organization control             |
| **Admin**  | Manage organization resources         |
| **Member** | Access assigned organization features |

### 🔐 Authentication

Authentication and account management powered by Supabase.

* Sign up
* Login
* Email confirmation
* Password recovery
* Password update
* Protected dashboard routes

---

## 📊 Dashboard

The SentinelGrid dashboard provides a central view of the organization's monitoring environment.

The goal is to provide a clean operational interface inspired by modern observability platforms while keeping security information easy to understand.

```text
Dashboard
│
├── Overview
│
├── Monitors
│   ├── Monitor List
│   └── Monitor Details
│
├── Organizations
│   ├── Organization List
│   ├── Members
│   ├── Invitations
│   └── Settings
│
├── Incidents
│
├── Alerts
│
├── Profile
│
└── Settings
```

### Operations: Incidents and Alerts

Both pages use the existing dark dropdown menus for status and time filters. Selections
apply immediately; search updates automatically after a 250 ms typing pause (Enter
applies immediately). Reset and clear-search cancel queued searches. Filters stay in
the URL and reset pagination, with server-side queries, limits and tenant isolation
unchanged. Only the filter toolbar is interactive; evidence remains server-rendered.


`/dashboard/incidents` shows historical command failures/expirations and separate,
uncorrelated failed audit events. Each command is represented once; audit events
with command or transaction correlation are excluded from the audit-exceptions
view. Confirmed no-newer-version and no-eligible-release codes are excluded from
command failures. Legacy ambiguous no-eligible-release results remain informational,
using the existing action-feedback helper rather than claiming an update failure
or inventing a current version. Recorded result versions and transaction IDs remain
available in expandable evidence. This is not a ticketing or incident-lifecycle system.

`/dashboard/alerts` derives device signals from stored status and the existing
90-second heartbeat cutoff. The personal-monitors tab shows failed last checks and
monitors without a check. The current monitor schema uses `user_id`, not an
organization relationship: this tab is explicitly personal and queries only the
signed-in user's monitors. Last heartbeat/check timestamps are evidence timestamps,
not invented incident start times. Existing monitor-history and client-device pages
remain the destinations for investigation and actions.

Both routes load on the server through the existing organization context and
cookie-authenticated Supabase client. Organization filters and existing RLS apply
to all organization data; browser-supplied organization/user IDs are never accepted
as authority. No service-role client, schema, permission, MFA or policy changes are
introduced. The new routes do not query the restricted `agent_update_transactions`
table; they reuse recorded command results/transaction references instead. Existing
Device Activity transaction enrichment is unchanged.

Search, source/status filters, a 1/7/30/90-day incident window and pagination live in
the URL. Lists read at most 26 records for 25 visible rows and a next-page indicator,
with stable timestamp/ID ordering. Incident dates filter request/audit creation time;
page summaries describe only displayed records, not fleet totals. Device context is
loaded once per incident page for its visible device IDs, not once per row. Alerts
use a single joined query for the selected source. Page offsets are bounded to 1,000
pages; narrow filters for more history. Offset-based snapshots can shift when new
records arrive; this is not a frozen audit export.

Refresh is manual, with pending feedback and fresh server reads. There is no added
polling or Realtime subscription. Native expandable evidence needs no client-side
state; only refresh/error recovery uses Client Components. Query failures are logged
server-side and displayed distinctly from empty results. Device-context failures
preserve the recorded evidence. Reads have an eight-second timeout; loading uses
the existing dashboard skeleton. No raw metadata, command payload, process output,
monitor URL credentials or enrollment secrets are rendered.

Assignment, acknowledgment, resolution, silencing, alert rules and notification
channels are deliberately absent because no corresponding persisted backend was
found. No mock production data or nonfunctional action buttons are supplied. Terminal,
Actions, RDP, Agent Update, Dashboard, Clients and global navigation are unchanged.

Run `node --test scripts\test-operations.mjs` for the server-loader, serialized
Supabase query, scope, pagination, heartbeat boundary, error and SSR checks. These
use the real Supabase query builder with an in-memory HTTP response harness, not
an authenticated production database. Use `npm run build` and `npx tsc --noEmit`
for production compilation/type checking.

---

## 🧱 Tech Stack

### Frontend

* **Next.js**
* **React**
* **TypeScript**
* **Tailwind CSS**

### Backend

* **Supabase**
* **PostgreSQL**
* **Supabase Authentication**
* **Supabase API**

### Infrastructure

* **Vercel**
* **Supabase Cloud**

---

## 🗄️ Architecture

```text
                  ┌─────────────────┐
                  │      User       │
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │     Next.js     │
                  │   Application   │
                  └────────┬────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
     ┌─────────────────┐       ┌─────────────────┐
     │    Supabase     │       │ Monitoring Core │
     │ Authentication  │       │                 │
     └────────┬────────┘       └────────┬────────┘
              │                         │
              └────────────┬────────────┘
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │
                  │    Database     │
                  └─────────────────┘
```

---

## 🛡️ Security Model

SentinelGrid is designed around **organization isolation**.

Each organization has its own:

* Members
* Roles
* Monitors
* Settings
* Invitations
* Security data

Access to organization resources is validated using membership relationships and role permissions.

```text
User
 │
 ▼
Organization Member
 │
 ├── Owner
 ├── Admin
 └── Member
 │
 ▼
Organization Resources
```

---

## 🧪 Current MVP

The current development phase focuses on building the core platform foundation.

### Implemented / In Development

* [x] Authentication
* [x] User accounts
* [x] Dashboard structure
* [x] Organization creation
* [x] Organization management
* [x] Organization roles
* [x] Organization settings
* [x] Organization invitations
* [x] Member management
* [x] Monitor management
* [x] Notification center
* [ ] Advanced alerts
* [ ] Monitoring history improvements
* [ ] Security analytics

---

## 🗺️ Roadmap

SentinelGrid is designed to grow beyond basic uptime monitoring.

### Phase 1 — Monitoring

* HTTP/HTTPS monitoring
* Availability tracking
* Response history
* Organization management
* Alerts
* Notifications

### Phase 2 — Asset Discovery

* Domain discovery
* Subdomain discovery
* IP discovery
* Port scanning
* Service identification
* DNS monitoring
* TLS certificate monitoring

### Phase 3 — Security Intelligence

* Vulnerability detection
* CVE correlation
* Misconfiguration detection
* Exposed services
* Security findings
* Risk scoring
* Asset criticality

### Phase 4 — Attack Surface Management

* External attack surface mapping
* Asset relationship visualization
* Attack paths
* Security posture scoring
* Prioritized remediation
* Historical security posture

### Phase 5 — Platform

* Custom dashboards
* Integrations
* Webhooks
* API access
* Agents
* Advanced alerting
* Reports
* Subscription plans

---

## 🚀 Getting Started

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/sentinelgrid.git
```

Enter the project:

```bash
cd sentinelgrid
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env.local
```

Configure the required Supabase environment variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Device Activity timeline

The device Activity tab groups recent audit events and `device_commands` by
command ID or update transaction ID, scoped to the selected device. It retains
the audit trail in keyboard-accessible expandable rows, with action labels,
status badges, local Today/Yesterday/Older groups, category filters and search.
The existing 30-second dashboard refresh also refreshes Activity; a manual
refresh button is available. Audit/command query failures are shown explicitly;
optional update-transaction failures are logged only on the server, without an
Activity warning. Enrichment has a three-second timeout and is retried on the
next normal refresh.

The dashboard reads up to 100 recent audit events and 100 recent commands for
the client, plus commands referenced by those audit events. This is a recent
activity view, not a complete audit-log export. Audit/command/device reads use
the signed-in user's Supabase client and existing RLS. The server-only update
transaction table is read with the existing admin client only after verifying
the user's organization ownership/membership, constrained to RLS-visible device
IDs, linked transaction IDs and the devices' organization. Only recorded version
fields reach the browser; no audit records, policies or schemas change.

Update versions prefer audit metadata/command results, then the device-scoped
`agent_update_transactions` linked by `device_commands.update_transaction_id`,
then the command payload. The transaction query selects existing ID/target fields;
previous versions come from recorded audit/result metadata or its update journal.
A recorded previous version shows the version transition;
target-only success shows `Updated to <version>`. Versions never come from the
device's current version. Errors come from recorded metadata/command results.
Duration is request-to-completion when both
timestamps exist, otherwise a recorded duration when available. Missing versions
are not invented. Technical IDs and original audit actions stay inside details;
arbitrary metadata, tokens and download URLs are not rendered.

Run the normalization and rendering checks with `node --test scripts\test-device-activity.mjs`.

### Device Actions

Actions are grouped as Maintenance (Force Inventory, Flush DNS, GPUpdate), Agent
(Restart Agent, Update Agent) and Power (Lock, Restart Computer, Shutdown Computer).
All eight use the existing authorized `device_commands` API and typed Realtime
channel. Availability is checked server-side for ownership/admin role,
organization policy, liveness, active commands and incompatible update transactions.
All actions can be requested without relying on cached capability flags. Update
Agent requests a live check even when no newer release is known to the dashboard;
release selection, installation enablement, readiness and failed-release protection
remain enforced by the existing update API and Agent. No eligible release or an
unsupported action produces the existing command result in Activity, not a fabricated
success. Restart and shutdown require confirmation. Disabled actions expose their
reason by mouse hover and keyboard focus, without availability badges.
The menu prefetches availability while closed and retains it between openings;
pending checks alone do not disable actions. Command submission still enforces all
server-side checks. Opening uses a brief reduced-motion-aware animation; clicking
or moving focus outside, or pressing Escape, dismisses the menu.

Action notifications use blue for queued/informational outcomes, amber for running
or unconfirmed operations, green only for confirmed completion, and red for errors.
They include a human-readable action/result, actionable explanation, and error code
when available; dismissing a notification never cancels a command. Invalid/non-JSON
submission responses and network failures are treated as unconfirmed submissions,
not proof that the command was rejected. Status polling retries transient failures
up to three consecutive times and never describes an accepted command as unsubmitted.
The Agent distinguishes an already-current version from failed-release protection
and disabled installation using structured error codes on the existing command result.
For older Agents, the authorized command-status endpoint can also confirm an
already-current version using the existing update-check state, but only when that
check occurred between this command's start and completion. This optional, device-scoped
server-side lookup has a two-second timeout and never changes command/audit records.
Missing, stale or inaccessible state leaves the legacy no-eligible-release result
as neutral information, not proof of being up to date. Rebuilding/signing the Agent
enables precise no-newer/blocked/policy codes without that optional lookup.
Transaction execution, terminal command statuses and audit history are unchanged.
Notification checks: `node --test scripts\test-device-action-feedback.mjs scripts\test-update-command-feedback.mjs`.

Deploy the website **and rebuild/restart the Realtime relay** (`npm run build:realtime`).
Build/sign and install an MSI containing both the new Agent and Updater before
qualifying the new actions. The existing Agent-only auto-update intentionally does
not replace the Updater. `SentinelGridUpdater.exe -command-protocol` must report
`sentinelgrid-device-commands-v1` for Restart Agent execution to be supported. Do not replace
installed EXEs manually or sign artifacts after hashes/manifests are generated.
No schema changes or Terminal/RDP deployment changes are required.

The remote terminal restores input focus when connected and after each command
finishes (including errors), in both PowerShell and CMD. Local `clear`/`cls`
commands also keep the input focused. Escape closes the terminal using the same
session cleanup as the close button; command delivery and history are unchanged.

Non-update commands persist delivery and recovery in protected `updates\command.json`.
The Agent waits for a Realtime receipt confirming the persisted running state
before executing. Results survive disconnects and are retried until acknowledged;
duplicate/expired commands are not executed again. Force Inventory recollects the
full supported inventory, uploads it immediately without resetting metrics, and
refreshes the service's cache only after acceptance. Flush DNS and GPUpdate retain
bounded stdout/stderr and exit code; GPUpdate has a ten-minute execution timeout.
Failures remain failures in Activity, including their real error codes.

Restart Agent is performed by the signed recovery service (up to three attempts),
not by the Agent killing itself. Success requires an authenticated heartbeat from
a different process identity. Reboot requires a different Windows boot identity.
Power requests allow at least 30 seconds to persist Windows' acceptance. Shutdown
completion means Windows accepted the request and the device subsequently stopped
heartbeating (or a later boot was confirmed); offline alone is not proof of success.
The relay reconciles deadlines even without connected agents: five minutes for
ordinary actions/restart/shutdown, fifteen for GPUpdate, thirty for reboot, plus
any requested power delay. Update transactions keep their existing recovery flow.
Only orphaned update commands expire here, with an additional fifteen-minute
staging grace for acknowledged/running requests that never established a transaction.

Safe automated checks: `node --test scripts\test-device-actions.mjs scripts\test-device-activity.mjs`,
`npm run test:realtime`, and from `agent`, `go test ./...` and `go vet ./...`.
These do not restart/lock/shut down the developer machine. Qualify live power and
service actions on a disposable Windows device with console access after deployment.

### Windows Agent development signing and baseline repair

Use `scripts\build-agent.ps1 -Version 0.1.6 -Channel beta -DevSign` with the
explicit development certificate thumbprint, certificate store and SHA256 signer
pin. `-Sign` is the production signing mode; the development certificate requires
`-DevSign` and cannot produce stable releases. No private-key export is needed.

The pipeline signs and verifies Agent, Updater and RDP executables before MSI
packaging, signs the MSI, and only then generates hashes and the manifest. A
failed build may leave incomplete artifacts; archive that version directory
before rebuilding. Never sign an existing manifest's artifacts in place.

For an installed development baseline whose MSI maintenance coordinator needs
repair, `-DevRepairProductCode <installed-product-guid>` retains the same product
and version. This requires `-DevSign`, forbids `-Publish`, and produces a manifest
that the publisher also rejects. Use elevated Windows Installer
`msiexec /fvamus <rebuilt-baseline-msi> /qn /norestart` for that baseline only,
then run `scripts\test-agent-update-readiness.ps1 -ExpectedSignerSHA256 <pin>`.
The installer applies service ACLs that reserve lifecycle control for SYSTEM and
Administrators. Readiness evaluates filesystem ACLs by SID, without requiring
account-name resolution. Baseline repair is not evidence of an automatic update.
---


## Brand assets

The blue ribbon S and outlined SENTINEL / GRID lettering are SVG redraws based on
the supplied brand reference, not an archived copy of the original uploaded PNG.
Canonical transparent sources live in `public\logos\sentinelgrid-mark.svg`
(symbol only) and `public\logos\sentinelgrid-wordmark.svg` (lettering only).
The combined stacked logo is `public\logos\sentinelgrid-logo.svg`. Each variant
also has a PNG export. Lettering uses vector paths, with no external fonts.

Use `components\brand-logo.tsx` for UI branding. The marketing/auth headers,
dashboard sidebar, onboarding and loading screens share these assets.
Use `variant="lockup"` in compact navigation: the blue S alongside a single-line
SentinelGrid label in the application's font, without a badge or tagline.
The outlined two-row wordmark remains available as an asset for larger formats;
do not shrink it into navigation headers. Legacy
PNG URLs remain available with the new branding. `app\icon.png`,
`app\apple-icon.png` and `public\og-image.png` cover browser bookmarks, Apple
home-screen icons and social previews. The social image remains 1200 x 630.

After changing the canonical SVGs, run `node scripts\generate-brand-assets.mjs`
to regenerate the combined logo, PNG exports and metadata images using Sharp
already supplied by Next.js. Check with `node --test scripts\test-brand-assets.mjs`.
Do not use the white lettering on a light background.

## 🎯 Vision

SentinelGrid aims to become a single interface where organizations can understand:

**What is exposed?**

**What is vulnerable?**

**What changed?**

**What should be fixed first?**

Instead of forcing teams to analyze information across multiple disconnected security tools, SentinelGrid aims to bring monitoring, visibility and security intelligence into one platform.

---

<div align="center">

### 🛡️ SentinelGrid

**Visibility is the first layer of security.**

Built for modern infrastructure.

</div>
