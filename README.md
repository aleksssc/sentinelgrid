<div align="center">

<img src="./public/logos/sentinelgrid-logo.svg" alt="SentinelGrid" width="420" />

<br />

Monitor. Manage. Respond.

A modern multi-tenant platform for infrastructure monitoring, endpoint management and secure remote operations.

<br />





<br />










<br />

Overview ·
Features ·
Architecture ·
Security ·
Agent ·
Plans ·
Development ·
Roadmap

</div>

⚡ Overview

SentinelGrid is an RMM and monitoring platform built for IT teams, MSPs and organizations that need one operational view of their infrastructure.

It combines:

Monitoring
    +
Inventory & Device Health
    +
Remote Actions
    +
Terminal & RDP
    +
Alerts & Incidents
    +
Audit & Agent Lifecycle

Know what is happening, understand what changed, and act safely from one place.

SentinelGrid is multi-tenant by design, with organization isolation, role-based access, subscription-aware entitlements and server-side authorization.

✨ Core Features

<table>
<tr>
<td width="50%" valign="top">

🖥️ Endpoint Management

Windows Agent enrollment

Hardware & OS inventory

Device online/offline state

CPU, RAM and disk telemetry

Agent version tracking

Device Activity timeline

Performance history

Client / site / device hierarchy

</td>
<td width="50%" valign="top">

⚡ Remote Operations

Force Inventory

Flush DNS

GPUpdate

Restart Agent

Update Agent

Lock workstation

Restart computer

Shutdown computer

</td>
</tr>

<tr>
<td width="50%" valign="top">

💻 Remote Access

PowerShell terminal

CMD terminal

Authenticated realtime transport

Native outbound RDP architecture

Session expiry and limits

One-use RDP tickets

Remote-access organization policies

</td>
<td width="50%" valign="top">

📡 Monitoring & Operations

HTTP/HTTPS monitoring

Response status & latency

Monitoring history

Alerts

Incidents

Audit logs

Notifications

Operational evidence

</td>
</tr>
</table>

🧭 Product Structure

Dashboard
│
├── Overview
├── Monitors
├── Organizations
│   ├── Members
│   ├── Invitations
│   ├── Clients
│   └── Settings
├── Devices
│   ├── Overview
│   ├── Activity
│   ├── Performance
│   ├── Actions
│   ├── Terminal
│   └── RDP
├── Incidents
├── Alerts
├── Billing
├── Profile
└── Settings

flowchart LR
    O["Organization"] --> C["Client"]
    C --> S["Site"]
    C --> D["Device"]

🏗️ Architecture

flowchart TB
    Browser["Browser / Dashboard"]
    Vercel["Next.js App<br/>Vercel"]
    Supabase["Supabase<br/>Auth + PostgreSQL + RLS"]
    Redis["Upstash Redis"]
    Realtime["Realtime Relay<br/>Railway"]
    RDPRelay["RDP Relay"]
    Agent["SentinelGridAgent<br/>Windows / Go"]
    Updater["SentinelGridUpdater"]
    RDP["SentinelGridRDP"]

    Browser --> Vercel
    Vercel --> Supabase
    Vercel --> Redis
    Browser <--> Realtime
    Agent <--> Realtime
    Realtime <--> Redis
    Realtime <--> Supabase
    Browser <--> RDPRelay
    RDP <--> RDPRelay
    Agent --> Updater
    Agent --> RDP
    Agent --> Vercel

Service

Responsibility

Vercel

Next.js app, dashboard, HTTP APIs, heartbeat, monitoring, billing UI, update APIs

Supabase

Auth, PostgreSQL, RLS, organizations, devices, commands, sessions, subscriptions

Railway

Persistent realtime WebSocket service

Upstash Redis

Pub/sub, short-lived tickets, distributed locks, rolling telemetry

Windows Agent

Inventory, heartbeat, telemetry, remote commands, terminal execution, update lifecycle

RDP Relay

Native RDP transport

Persistent realtime traffic is intentionally kept outside Vercel Functions.

🧱 Tech Stack

Area

Technology

Web

Next.js, React 19, TypeScript

UI

Tailwind CSS, Radix UI, lucide-react, next-themes

Auth

Supabase Auth

Database

PostgreSQL / Supabase

Tenant isolation

Supabase RLS + server-side access checks

Realtime

Node.js, ws, Upstash Redis

Agent

Go

Windows installer

WiX Toolset

Signing

Authenticode

Hosting

Vercel + Railway

🔐 Security Model

SentinelGrid treats authorization as a backend responsibility.

flowchart TB
    User["Authenticated User"]
    Membership["Organization Membership"]
    Owner["Organization Owner"]
    Subscription["Owner Subscription"]
    Role["Role Permission"]
    Entitlement["Plan Entitlement"]
    State["Subscription State"]
    Access["Effective Access"]

    User --> Membership
    Membership --> Owner
    Owner --> Subscription
    Membership --> Role
    Subscription --> Entitlement
    Subscription --> State
    Role --> Access
    Entitlement --> Access
    State --> Access

The effective rule is:

Role permission
AND
Owner plan entitlement
AND
Subscription status

Roles

Role

Intended access

Owner

Full organization, billing, members, infrastructure and remote capabilities

Admin

Operational management and remote capabilities

Member

Primarily read-only / observational access

Central authorization lives in:

lib/organization-access.ts
lib/organization-access-core.ts
lib/plans.ts

Relevant permissions include:

organization.manage
billing.manage
members.manage
clients.create
clients.manage
devices.create
devices.manage
devices.actions
devices.terminal
devices.rdp
monitors.create
monitors.manage

💳 Subscription Model

Subscriptions belong to the organization owner account.

Owner account
└── Pro subscription
    └── Organization
        ├── Owner
        └── Invited Admin
            └── Personal plan = Free

Inside that organization, the invited Admin can use Pro capabilities because the organization inherits the owner's subscription.

The invited member's personal plan does not decide organization access.

💎 Plans & Entitlements

Current limits

Plan

Members

Clients

Devices

Monitors

Free

1

3

10

10

Pro

5

25

100

100

Business

20

Unlimited

500

500

Enterprise

Custom

Custom

Custom

Custom

Current prices in code

Plan

Price

Free

€0

Pro

€24.99 / month

Business

€59.99 / month

Enterprise

Custom

Premium remote features

Feature

Free

Pro

Business

Enterprise

Device Actions

❌

✅

✅

✅

Terminal

❌

✅

✅

✅

RDP

❌

✅

✅

✅

Pricing is still product configuration and may change before commercial launch.

🔄 Subscription Lifecycle

Supported states:

active
trialing
past_due
grace_period
restricted
canceled

Status

Behavior

active

Full plan access

trialing

Full plan access

past_due

Features continue temporarily; billing warning

grace_period

Features continue temporarily; stronger billing warning

restricted

Existing data remains; paid actions and new resources are blocked

canceled

Existing data remains; paid actions and new resources are blocked

SentinelGrid does not delete customer infrastructure because of a downgrade or failed payment.

🖥️ Windows Agent

SentinelGrid includes a native Windows Agent written in Go.

Current repository version:

0.1.12

Service name:

SentinelGridAgent

Responsibilities

enrollment

authenticated heartbeat

hardware & OS inventory

CPU / RAM / disk telemetry

device presence

realtime communication

typed remote commands

terminal execution

update checks

secure update handoff

command recovery

Inventory

Hostname
Operating System
OS Version
OS Build
Architecture
Local IP
MAC Address
Manufacturer
Model
Serial Number
CPU
RAM
Agent Version

🔗 Device Enrollment

flowchart LR
    Token["Enrollment Token"] --> API["SentinelGrid API"]
    API --> Identity["Device / Agent Identity"]
    Identity --> AgentToken["Long-lived Agent Token"]

Enrollment is intended to obey:

devices.create
+
plan device limit
+
subscription state

so Agent enrollment cannot bypass SaaS limits.

📈 Performance & Telemetry

Device Performance uses real heartbeat metrics.

Supported ranges:

1 hour

24 hours

7 days

30 days

Endpoint:

GET /api/devices/:deviceId/performance?range=1h|24h|7d|30d

Key behavior:

storage failure does not fail heartbeat

old values are not backfilled

wider periods use lower sampling density

disk usage means capacity used, not I/O throughput

reads are authorized before Redis access

Redis history is rolling telemetry, not a durable audit store

Test:

npm run test:performance

⚡ Device Actions

<table>
<tr>
<td width="33%" valign="top">

Maintenance

Force Inventory

Flush DNS

GPUpdate

</td>
<td width="33%" valign="top">

Agent

Restart Agent

Update Agent

</td>
<td width="33%" valign="top">

Power

Lock

Restart Computer

Shutdown Computer

</td>
</tr>
</table>

Device Actions use:

server-side authorization

devices.actions

plan entitlement checks

subscription state checks

rate limiting

idempotency

Redis locking

device availability checks

organization remote-access policy

audit logging

realtime delivery

expiry and recovery

💻 Remote Terminal

Supported shells:

PowerShell
CMD

sequenceDiagram
    participant B as Browser
    participant A as Next.js API
    participant R as Realtime Relay
    participant W as Windows Agent

    B->>A: Create Terminal session
    A-->>B: Authorized session
    B->>R: JWT-authenticated WebSocket
    R->>W: Terminal command
    W-->>R: stdout / stderr / exit code
    R-->>B: Result

Authorization is enforced during both:

HTTP session creation
+
Realtime WebSocket handshake

using:

devices.terminal
+
terminal entitlement
+
owner subscription status

🖥️ Native RDP

SentinelGrid includes an outbound RDP architecture that avoids exposing inbound RDP directly from managed endpoints.

flowchart LR
    Client["Remote Client"]
    API["SentinelGrid API"]
    Relay["RDP Relay"]
    RDP["SentinelGridRDP"]
    Win["Windows RDP"]

    Client --> API
    API --> Client
    Client <--> Relay
    RDP <--> Relay
    RDP <--> Win

Existing protections include:

authenticated session creation

organization policy

device capability checks

online-state checks

rate limiting

session limits

short-lived one-use tickets

ticket hashing

session expiry

idle timeout

browser origin validation

relay authentication

session revocation

auditing

Core files:

lib/remote/rdp.ts
lib/remote/rdp-policy.ts
app/api/devices/[deviceId]/rdp
relay/

RDP subscription/entitlement enforcement is the next authorization step.

🌐 Realtime

Realtime carries:

Agent presence

Device Actions

command results

Terminal

RDP availability notifications

Browser / Agent
      ↓
Realtime Relay
      ↓
Redis / Supabase

Next.js keeps pages, authentication, HTTP APIs, heartbeat, monitoring, command submission, update APIs and endpoint discovery.

npm run build:realtime
npm run start:realtime
npm run test:realtime

See relay/README.md for deployment and rollback details.

🚨 Incidents & Alerts

Incidents

The current Incidents page surfaces operational failures and audit evidence, including:

failed device commands

expired commands

selected audit failures

update-related evidence

It is not yet a full ticketing / ITSM workflow.

Alerts

Current signals include:

device heartbeat state

device offline state

monitor failures

monitors without recent checks

Alert rules, silencing, acknowledgement and notification channels are planned later.

🧾 Device Activity

Device Activity combines:

audit events

device commands

update evidence

Where possible, related records are correlated with command and update transaction identifiers.

SentinelGrid intentionally avoids inventing missing versions, durations or success states.

🔄 Agent Updates

The full-product MSI contains:

SentinelGridAgent.exe
SentinelGridUpdater.exe
SentinelGridRDP.exe

The Agent scheduler and Update Agent action share the same secure update pipeline.

Protections

release eligibility

release channel policy

release delay

HTTPS download

size verification

SHA256 verification

Authenticode verification

signer pinning

MSI product validation

UpgradeCode validation

staged update journal

transaction correlation

Windows Installer handoff

authenticated post-update heartbeat

config preservation

explicit recovery state

Current update protocol:

Protocol 2

Detailed documentation:

installer/windows/UPDATES.md

📡 Monitoring

HTTP/HTTPS monitoring works independently from the Windows Agent.

Current capabilities:

monitor creation

availability checks

response status

response time

monitor health

history

dashboard summaries

🧾 Audit Logging

Operational and security-sensitive actions are recorded through the audit layer.

Examples:

organization changes

member management

remote command requests

remote-access activity

update lifecycle evidence

🎨 Dashboard Experience

Appearance presets:

Sentinel
Midnight
Aurora
Graphite

Interface preferences include:

Comfortable / Compact density

System / Full / Reduced motion

Expanded / Compact / Remember sidebar state

List / Grid default client view

These affect presentation only and never backend authorization.

💰 Billing Architecture

Application subscription state is centered around:

account_subscriptions

Known fields used by the application include:

user_id
plan
status
custom_price_monthly
custom_max_members
custom_max_clients
custom_max_devices
custom_max_monitors
current_period_end
cancel_at_period_end

Intended production flow:

flowchart LR
    Provider["Billing Provider"]
    Webhook["Webhook"]
    Subscription["account_subscriptions"]
    Access["Access Layer"]
    App["Application"]

    Provider --> Webhook
    Webhook --> Subscription
    Subscription --> Access
    Access --> App

✅ Project Status

Area

Status

Authentication

✅ Implemented

Organizations

✅ Implemented

Members & Invitations

✅ Implemented

Clients / Sites / Devices

✅ Implemented

Windows Agent

✅ Implemented

Inventory / Heartbeat

✅ Implemented

Device Performance

✅ Implemented

Device Activity

✅ Implemented

Device Actions

✅ Implemented

Device Actions subscription enforcement

✅ Implemented

Terminal

✅ Implemented

Terminal subscription enforcement

✅ Implemented

Realtime Relay

✅ Implemented

RDP Architecture

✅ Implemented

RDP subscription enforcement

🟡 In progress

Incidents

✅ Implemented

Alerts

✅ Implemented

Audit Logging

✅ Implemented

Plan & Entitlement Foundation

✅ Implemented

Billing Provider Integration

⏳ Planned

Production-qualified Agent Updates

🟡 In progress

Production-qualified RDP

🟡 In progress

DNS / Domains

⏳ Later

🗂️ Repository Structure

sentinelgrid/
│
├── agent/                      # Go Windows Agent
├── app/                        # Next.js App Router
├── components/                 # Shared UI
├── installer/                  # MSI / update documentation
├── lib/
│   ├── audit/
│   ├── realtime/
│   ├── remote/
│   ├── supabase/
│   ├── organization-access-core.ts
│   ├── organization-access.ts
│   └── plans.ts
├── relay/                      # Realtime / RDP relay
├── scripts/                    # Tests, builds and release tooling
├── public/                     # Brand and static assets
├── .env.example
├── package.json
└── README.md

⚙️ Environment

Use .env.example as the reference and create .env.local.

<details>
<summary><strong>Supabase</strong></summary>

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=

</details>

<details>
<summary><strong>Upstash Redis</strong></summary>

UPSTASH_REDIS_KV_REST_API_URL=
UPSTASH_REDIS_KV_REST_API_TOKEN=

</details>

<details>
<summary><strong>Realtime</strong></summary>

SENTINELGRID_REALTIME_URL=
SENTINELGRID_REALTIME_BROWSER_ORIGIN=
SENTINELGRID_REALTIME_BIND=
SENTINELGRID_REALTIME_PORT=

</details>

<details>
<summary><strong>RDP Relay</strong></summary>

SENTINELGRID_RELAY_URL=
SENTINELGRID_RDP_RELAY_SECRET=
SENTINELGRID_RDP_BACKEND_URL=
SENTINELGRID_RELAY_BIND=
SENTINELGRID_RELAY_PORT=

</details>

<details>
<summary><strong>Agent Updates & Signing</strong></summary>

SENTINELGRID_AGENT_UPDATES_ENABLED=
SENTINELGRID_SIGN_CERT_THUMBPRINT=
SENTINELGRID_UPDATE_SIGNER_SHA256=
SENTINELGRID_SIGN_TIMESTAMP_URL=

</details>

Never commit production secrets, service-role credentials or private signing material.

🚀 Local Development

Requirements

Node.js 22+

npm

Go toolchain matching agent/go.mod

Supabase project

Upstash Redis

WiX Toolset for MSI builds

Windows signing tools for signed releases

Clone

git clone https://github.com/aleksssc/sentinelgrid.git
cd sentinelgrid

Install

npm install

Environment

Copy-Item .env.example .env.local

Run

npm run dev

Open:

http://localhost:3000

🧪 Testing

Web

npm run build
npm run lint
npx tsc --noEmit

Performance

npm run test:performance

Realtime

npm run test:realtime

Device Actions

node --test `
  scripts/test-device-actions.mjs `
  scripts/test-device-actions-access.mjs

Terminal access

node --test `
  scripts/test-terminal-access.mjs `
  scripts/test-terminal-realtime-access.mjs

RDP

node --test `
  scripts/test-rdp-policy.mjs `
  scripts/test-rdp-http.mjs `
  scripts/test-rdp-relay.mjs

Agent

cd agent
go test ./...
go vet ./...

Automated tests do not replace qualification on a disposable enrolled Windows machine for destructive remote operations.

🗺️ Roadmap

Phase 1 — Core RMM & Monitoring

Authentication

Organizations

Members & invitations

Clients

Sites

Devices

Windows Agent

Heartbeat

Inventory

Performance

Activity

Device Actions

Terminal

Realtime relay

RDP architecture

Incidents

Alerts

Audit logs

Phase 2 — SaaS Authorization & Billing

Centralized role / subscription access layer

Device Actions entitlement enforcement

Terminal HTTP entitlement enforcement

Terminal realtime entitlement enforcement

RDP entitlement enforcement

Resource limits for Clients / Devices / Monitors

Enrollment limit enforcement

Billing provider integration

Subscription lifecycle automation

Phase 3 — Remote Management Maturity

Production-qualify RDP

Production-qualify automatic Agent updates

Expand remote administration capabilities

Improve recovery and diagnostics

Phase 4 — Monitoring & Security Expansion

SSL certificate monitoring

DNS monitoring

Domain management

Port discovery

Service identification

Exposed-service detection

Vulnerability correlation

Security findings

Risk scoring

Phase 5 — Platform

Reports

API access

Webhooks

Integrations

Advanced RBAC

Enterprise customization

🧠 Engineering Principles

✓ Server-side authorization
✓ Tenant isolation
✓ Least privilege
✓ Owner-subscription inheritance
✓ Short-lived remote access credentials
✓ Signed update chain
✓ No destructive downgrade
✓ No frontend-only security
✓ No unsigned Agent updates
✓ No fabricated telemetry
✓ No fabricated version history
✓ No direct exposure of server secrets

🎯 Vision

SentinelGrid aims to become the operational layer where IT teams can immediately answer:

What infrastructure do we manage?
What is online?
What changed?
What failed?
What needs attention?
What can we safely do remotely?
What should be fixed first?

The long-term goal is to combine monitoring, remote management and security visibility without forcing teams to jump between disconnected tools.

<div align="center">

<img src="./public/logos/sentinelgrid-mark.svg" alt="SentinelGrid" width="72" />

SentinelGrid

Visibility. Control. Security.

Built for modern infrastructure.

</div>