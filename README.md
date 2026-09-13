<div align="center">

🛡️ SentinelGrid

Monitor. Manage. Respond.

SentinelGrid is a multi-tenant infrastructure monitoring and remote-management platform for IT teams, MSPs and organizations.

It combines endpoint monitoring, organization-aware access control, remote actions, terminal access, RDP, incidents, alerts, agent telemetry and update management in a single operational interface.

<br />










</div>

Overview

SentinelGrid is being built as a unified platform for:

infrastructure monitoring

endpoint inventory

device health and performance

remote device actions

remote terminal access

native RDP sessions

organization and member management

incident and alert visibility

audit trails

agent lifecycle and updates

subscription-aware access control

The platform follows a strict multi-tenant model:

Account
  │
  ├── Subscription
  │
  └── Organization
        │
        ├── Members
        │
        └── Clients
              │
              ├── Sites
              │
              └── Devices

A user can belong to an organization without owning its subscription. Features inside an organization are determined by:

Organization membership role
+
Organization owner's account subscription
+
Plan entitlements
+
Subscription status

This allows, for example, a user with a personal Free account to use Pro capabilities inside a Pro organization when their organization role allows it.

Current Project Status

SentinelGrid is an active development project.

Implemented or substantially implemented

Supabase authentication

account onboarding

organization creation

organization invitations

member management

owner / admin / member roles

clients

sites

devices

device enrollment

Windows Agent

inventory collection

heartbeat telemetry

device online/offline state

device performance history

device activity timeline

remote device actions

terminal sessions

native RDP architecture

realtime WebSocket transport

alerts

incidents

audit logging

monitoring

notification center

appearance and interface preferences

billing page

plan limits and entitlements

subscription-aware authorization foundation

signed Windows build pipeline

Agent / Updater / RDP full-product MSI pipeline

In progress

full subscription enforcement across remote features

production billing provider integration

complete subscription lifecycle handling

production qualification of Agent auto-update

complete RDP qualification

additional device-management capabilities

Planned later

DNS monitoring

domain management

SSL/TLS monitoring

attack-surface discovery

security findings

vulnerability correlation

reporting

public API and integrations

Architecture

High-level architecture

                         ┌───────────────────────────┐
                         │          Browser          │
                         └─────────────┬─────────────┘
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │      Next.js Web App      │
                         │         Vercel            │
                         └───────┬─────────┬─────────┘
                                 │         │
                        HTTPS/API│         │Supabase
                                 │         │
                                 ▼         ▼
                     ┌────────────────┐  ┌────────────────────┐
                     │ Realtime Relay │  │      Supabase      │
                     │   Railway /    │  │ Auth + PostgreSQL  │
                     │ Persistent Node│  │      + RLS         │
                     └───────┬────────┘  └────────────────────┘
                             │
                             │ WebSocket
                             ▼
                     ┌────────────────┐
                     │ Windows Agent  │
                     │      Go        │
                     └───────┬────────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
                  ▼                     ▼
          SentinelGridUpdater   SentinelGridRDP

Redis is used for realtime coordination, short-lived tickets and rolling telemetry where appropriate.

Technology Stack

Web application

Next.js

React 19

TypeScript

Tailwind CSS

lucide-react

Radix UI primitives

next-themes

Backend and data

Supabase

PostgreSQL

Supabase Auth

Supabase SSR

Row Level Security

server-side admin client for trusted internal operations

Realtime

Node.js

ws

Upstash Redis

dedicated persistent realtime relay

existing legacy Vercel WebSocket routes retained during migration

Windows Agent

Go

Windows Service

Gorilla WebSocket

kardianos/service

Windows system APIs

signed binaries

WiX MSI packaging

Current Agent version in the repository:

0.1.12

Infrastructure

Vercel — web application and HTTP APIs

Supabase Cloud — database and authentication

Railway — persistent realtime relay

Upstash Redis — realtime coordination and telemetry history

Multi-Tenant Data Model

The primary hierarchy is:

organizations
  └── clients
       └── sites
       └── devices

Important platform tables and concepts include:

organizations
organization_members
organization_invites

clients
sites
devices

monitors

device_commands
remote_sessions
rdp_sessions

account_subscriptions

audit_logs

agent_update_transactions

Not every table is intended for direct browser access. Sensitive server-only operations use trusted server-side clients.

Authentication

Authentication is powered by Supabase.

Supported flows include:

sign up

login

logout

email confirmation

password recovery

password update

protected dashboard routes

organization onboarding

invitation-based joining

Users cannot arbitrarily join organizations. Membership is controlled through the invitation flow.

Organizations and Roles

SentinelGrid uses three organization roles.

Role

Intended access

Owner

Full organization control, billing, members, infrastructure and remote features

Admin

Operational management of clients, devices, monitors and remote features

Member

Read-only / observational access to organization data

The centralized authorization layer is implemented in:

lib/organization-access.ts

Relevant permission names include:

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

The authorization layer resolves:

Authenticated user
    ↓
Organization membership
    ↓
Organization owner
    ↓
Owner account subscription
    ↓
Role permission
    ↓
Plan entitlement
    ↓
Subscription status

Subscription Model

Subscriptions belong to accounts, not directly to members.

The owner account's subscription governs the organizations owned by that account.

Example:

Owner account:
  Plan = Pro

Organization:
  Owner = Pro account

Invited user:
  Personal plan = Free
  Organization role = Admin

Effective organization access:
  Pro entitlements
  +
  Admin permissions

A member's personal plan does not limit what that member can do inside another user's organization.

Plans

Current plan limits defined in the project:

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

Current prices defined in code:

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

These values are product configuration and may change before production launch.

Premium Feature Entitlements

Current entitlement model:

Feature

Free

Pro

Business

Enterprise

Device Actions

No

Yes

Yes

Yes

Terminal

No

Yes

Yes

Yes

RDP

No

Yes

Yes

Yes

Definitions live in:

lib/plans.ts

Important helpers include:

planHasFeature()
canUsePaidFeatures()
canCreateResources()
canCreateResource()
getPlanLimit()

Subscription Lifecycle

SentinelGrid currently models these statuses:

active
trialing
past_due
grace_period
restricted
canceled

Intended behavior:

Status

Access behavior

active

Full access according to plan

trialing

Full access according to plan

past_due

Features remain available temporarily; billing warning should be shown

grace_period

Features remain available temporarily; stronger billing warning

restricted

Existing data remains visible; paid actions and new resource creation are blocked

canceled

Existing data remains visible; paid actions and new resource creation are blocked

SentinelGrid must never automatically delete customer infrastructure because of a downgrade or payment failure.

Example:

Pro account
100 devices
        ↓
downgrade to Free
        ↓
100 devices remain visible
new devices are blocked until usage is below the Free limit

Existing heartbeats, inventory and monitoring should continue for enrolled devices even when a subscription is restricted.

Remote Device Management

Device Actions

Supported actions include:

Maintenance

Force Inventory

Flush DNS

GPUpdate

Agent

Restart Agent

Update Agent

Power

Lock

Restart Computer

Shutdown Computer

Device actions use the existing device_commands flow, with server-side authorization, idempotency, availability checks, rate limiting, audit logging and realtime dispatch.

Core implementation:

lib/remote/commands.ts
app/api/devices/[deviceId]/commands

The Agent persists command execution state so that accepted operations survive temporary realtime disconnects.

Remote Terminal

SentinelGrid supports remote terminal sessions for enrolled Windows devices.

Supported shells:

PowerShell

CMD

The terminal uses:

Browser
  ↓
Realtime relay
  ↓
Windows Agent

Session creation is handled server-side, while command transport uses authenticated realtime WebSockets.

Core implementation:

lib/remote/sessions.ts
lib/realtime/browser-socket.ts
components/dashboard/devices/device-terminal.tsx
app/api/devices/[deviceId]/sessions

The backend remains the authority for authorization. UI visibility alone is never treated as a security boundary.

Native RDP

SentinelGrid includes an outbound native RDP architecture.

The design avoids exposing an inbound RDP port directly from the managed endpoint.

Browser
   │
   │ authenticated request
   ▼
SentinelGrid API
   │
   │ short-lived ticket
   ▼
RDP Relay
   ▲
   │ outbound connection
   │
SentinelGridRDP
   │
   ▼
Windows RDP

Existing protections include:

authenticated session creation

owner/admin authorization

organization remote-access policy

Agent capability checks

device online checks

one-use tickets

ticket expiry

session expiry

relay authentication

rate limiting

session limits

idle timeout

revocation / session termination

browser origin validation

auditability

Core implementation:

lib/remote/rdp.ts
lib/remote/rdp-policy.ts
app/api/devices/[deviceId]/rdp
relay/

The current monetization work is integrating devices.rdp permissions and rdp plan entitlement into these existing protections without weakening the RDP protocol or relay security model.

Windows Agent

SentinelGrid includes a native Windows Agent written in Go.

Service name:

SentinelGridAgent

The Agent handles:

enrollment

authenticated heartbeat

inventory

CPU telemetry

RAM telemetry

disk-capacity telemetry

device online state

realtime communication

typed remote commands

terminal execution

update checks

update handoff

command result recovery

Inventory can include:

hostname

OS

OS version

OS build

architecture

local IP

MAC address

manufacturer

model

serial number

CPU

total RAM

Agent version

Device Enrollment

Enrollment uses a SentinelGrid-issued token.

The Agent exchanges the enrollment token for device-specific credentials and stores its configuration locally.

The design separates:

Enrollment token
        ↓
Initial enrollment
        ↓
Device / Agent identity
        ↓
Long-lived Agent token

Enrollment limits must ultimately obey organization plan limits and devices.create authorization so Agent enrollment cannot bypass SaaS resource limits.

Heartbeat and Inventory

The Agent sends authenticated heartbeats to the application.

Heartbeat data includes operational state such as:

last seen

public IP

CPU usage

RAM usage

RAM totals

disk usage

disk totals

uptime

optional inventory

Existing devices should continue to send heartbeat and inventory data even when the owning subscription becomes restricted.

Device Performance

The Performance tab displays rolling telemetry from Agent heartbeats.

Current ranges:

Last hour

24 hours

7 days

30 days

History is stored using server-side Upstash Redis configuration.

Retention is bounded and sampling is intentionally reduced at wider ranges.

The performance endpoint authorizes reads against the signed-in user's device visibility before reading Redis.

Example endpoint:

GET /api/devices/:deviceId/performance?range=1h|24h|7d|30d

Important behavior:

storage failures do not fail Agent heartbeats

old device values are not backfilled as historical samples

Redis history is rolling telemetry, not a durable audit store

disk usage represents capacity used, not I/O throughput

Test:

npm run test:performance

Realtime Architecture

SentinelGrid has a dedicated realtime layer for:

Agent presence

Terminal

device commands

command results

RDP availability notifications

The application can use a standalone Node relay instead of holding long-lived WebSockets inside Vercel Functions.

Migration model:

Before:
Browser / Agent
   ↓
Vercel WebSocket routes
   ↓
Redis / Supabase

After:
Browser / Agent
   ↓
Dedicated realtime relay
   ↓
Redis / Supabase

Next.js keeps:
- pages
- authentication
- HTTP APIs
- command submission
- heartbeat
- update APIs
- endpoint discovery

The native RDP binary transport remains separate from the general realtime relay.

Build:

npm run build:realtime

Run:

npm run start:realtime

Test:

npm run test:realtime

Incidents and Alerts

Incidents

The Incidents page currently surfaces operational failures and audit evidence.

It is not yet a full ticketing or incident-lifecycle platform.

Examples include:

failed device commands

expired commands

selected audit failures

update-related operational evidence

Assignment, acknowledgement, resolution workflows and silencing are planned for later.

Alerts

The Alerts page derives signals from existing stored state.

Current sources include:

device heartbeat / offline state

personal monitor failures

monitors without a recent check

Monitor ownership currently follows the existing personal user_id model.

Device Activity

The Device Activity timeline combines recent:

audit events

device commands

update evidence

Entries are correlated when command IDs or update transaction IDs are available.

The UI avoids fabricating missing state. Recorded versions, durations, error codes and transaction IDs are shown only when they actually exist.

Test:

node --test scripts/test-device-activity.mjs

Agent Updates

SentinelGrid includes a signed full-product update architecture.

The MSI contains:

SentinelGridAgent.exe
SentinelGridUpdater.exe
SentinelGridRDP.exe

The Agent and dashboard Update Agent action share the same secure MSI update pipeline.

Major update protections include:

version eligibility checks

channel policy

release delay policy

HTTPS download

exact size verification

SHA256 verification

Authenticode verification

signer pinning

MSI product validation

fixed UpgradeCode validation

staged update journal

transaction correlation

signed updater handoff

Windows Installer execution

process identity verification

authenticated post-update heartbeat

config preservation

explicit recovery state

Current protocol:

Protocol 2

Detailed update documentation:

installer/windows/UPDATES.md

Production auto-update qualification still requires isolated Windows VM lifecycle testing before broad enablement.

Windows Signing and MSI

The build pipeline supports development signing and production signing.

Typical development build:

.\scripts\build-agent.ps1 `
  -Version 0.1.12 `
  -Channel beta `
  -DevSign

The build pipeline signs and verifies:

Agent

Updater

RDP executable

MSI

Hashes and release manifests are generated after signing.

Do not manually replace installed EXEs or sign artifacts after hashes and manifests are generated.

Monitoring

SentinelGrid also includes HTTP/HTTPS monitoring.

Current capabilities include:

monitor creation

availability checks

response status

response time

monitor health

history

dashboard summaries

Monitoring is independent from the Windows Agent.

Audit Logging

Security-sensitive and operational actions are recorded through the audit layer.

Examples include:

organization actions

member management

device command requests

remote access activity

update lifecycle evidence

Audit logs are separate from rolling telemetry.

Dashboard

The dashboard includes areas such as:

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

The dashboard uses shared design primitives and a consistent dark operational interface.

Appearance and Interface Preferences

Users can customize dashboard presentation.

Available appearance presets include:

Sentinel

Midnight

Aurora

Graphite

Interface preferences include:

Comfortable / Compact density

System / Full / Reduced motion

Expanded / Compact / Remember sidebar mode

List / Grid default client view

Preferences are browser-side presentation settings and do not modify backend authorization or organization data.

Security Model

SentinelGrid follows several key principles.

1. Tenant isolation

Organization resources are scoped through ownership, membership and RLS.

2. Server-side authorization

A hidden or disabled button is never considered sufficient authorization.

Sensitive routes must validate access on the server.

3. Least privilege

Roles are distinct:

Owner  → administrative + operational
Admin  → operational
Member → read-only

4. Owner subscription inheritance

Organization features are based on the owner's account subscription, not on the invited member's personal subscription.

5. Short-lived remote access credentials

RDP and remote sessions use short-lived tickets and session expiry.

6. Signed update chain

Agent update artifacts are hash-verified, signature-verified and signer-pinned.

7. No destructive downgrade

Subscription downgrade or cancellation does not delete customer infrastructure.

Authorization Work in Progress

The centralized access model already exists in:

lib/organization-access.ts
lib/plans.ts

The next monetization/security step is to wire the access layer into all remote paths.

Priority:

1. Device Actions
2. Terminal HTTP session creation
3. Terminal realtime handshake
4. RDP session creation
5. RDP live-session revalidation
6. RDP browser status / close
7. Create Client
8. Create Device
9. Create Monitor
10. Enrollment

The final authorization rule for premium remote capabilities is:

Role permission
AND
Plan entitlement
AND
Subscription state allows paid features

Examples:

Free Owner
  Device Actions → denied
  Terminal       → denied
  RDP            → denied

Pro Owner
  Device Actions → allowed
  Terminal       → allowed
  RDP            → allowed

Pro Admin
  Device Actions → allowed
  Terminal       → allowed
  RDP            → allowed

Pro Member
  Device Actions → denied
  Terminal       → denied
  RDP            → denied

Restricted Pro
  Existing data  → visible
  Heartbeats     → continue
  Monitoring     → continue
  New resources  → denied
  Device Actions → denied
  Terminal       → denied
  RDP            → denied

Billing

The current billing model is based around:

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

Future production billing integration should keep provider-specific logic isolated.

Preferred design:

Billing Provider
      ↓
Webhook
      ↓
account_subscriptions
      ↓
organization access layer
      ↓
Entire application reacts automatically

Before any billing migration, the real Supabase schema and constraints should be inspected rather than assumed.

Environment Variables

Create:

.env.local

Use .env.example as the canonical reference.

Main variable groups include:

Supabase

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=

Application

NEXT_PUBLIC_SITE_URL=

Upstash Redis

UPSTASH_REDIS_KV_REST_API_URL=
UPSTASH_REDIS_KV_REST_API_TOKEN=

Standalone Realtime

SENTINELGRID_REALTIME_URL=
SENTINELGRID_REALTIME_BROWSER_ORIGIN=
SENTINELGRID_REALTIME_BIND=
SENTINELGRID_REALTIME_PORT=
SENTINELGRID_REALTIME_MAX_CONNECTIONS=
SENTINELGRID_REALTIME_TRUST_PROXY=

RDP Relay

SENTINELGRID_RELAY_URL=
SENTINELGRID_RDP_RELAY_SECRET=
SENTINELGRID_RDP_BACKEND_URL=
SENTINELGRID_RELAY_BIND=
SENTINELGRID_RELAY_PORT=

Agent Updates / Signing

SENTINELGRID_AGENT_UPDATES_ENABLED=

SENTINELGRID_SIGN_CERT_THUMBPRINT=
SENTINELGRID_UPDATE_SIGNER_SHA256=
SENTINELGRID_SIGN_TIMESTAMP_URL=

Never commit real credentials or private signing material.

Local Development

Requirements

Recommended:

Node.js 22+

npm

Go toolchain matching agent/go.mod

Supabase project

Upstash Redis

WiX Toolset for MSI builds

Windows SDK / signing tools when building signed Windows releases

Clone:

git clone https://github.com/aleksssc/sentinelgrid.git
cd sentinelgrid

Install dependencies:

npm install

Create local environment configuration:

Copy-Item .env.example .env.local

Start the Next.js application:

npm run dev

Open:

http://localhost:3000

Realtime Development

Build the relay:

npm run build:realtime

Run it:

npm run start:realtime

For local testing, the web application and realtime relay normally run in separate terminals.

More detail:

relay/README.md

Testing

Web

npm run build
npm run lint
npx tsc --noEmit

Performance

npm run test:performance

Realtime

npm run test:realtime

Device actions / activity

node --test `
  scripts/test-device-actions.mjs `
  scripts/test-device-activity.mjs `
  scripts/test-device-action-feedback.mjs `
  scripts/test-update-command-feedback.mjs

RDP

node --test `
  scripts/test-rdp-policy.mjs `
  scripts/test-rdp-http.mjs `
  scripts/test-rdp-relay.mjs

Agent

cd agent
go test ./...
go vet ./...

Automated tests do not replace qualification on a disposable enrolled Windows device for destructive actions such as lock, restart or shutdown.

Repository Structure

sentinelgrid/
│
├── agent/                      # Go Windows Agent
├── app/                        # Next.js App Router
├── components/                 # Shared UI components
├── installer/                  # Windows MSI / update documentation
├── lib/
│   ├── audit/
│   ├── realtime/
│   ├── remote/
│   ├── supabase/
│   ├── organization-access.ts
│   └── plans.ts
├── relay/                      # Standalone realtime / RDP relay code
├── scripts/                    # Tests, build and release tooling
├── public/                     # Brand and static assets
├── .env.example
├── package.json
└── README.md

Deployment Model

Vercel

Hosts:

Next.js application

dashboard

HTTP APIs

authentication flows

heartbeat endpoints

monitor APIs

billing UI

update APIs

endpoint discovery

Railway

Hosts the persistent realtime service.

This avoids relying on long-lived WebSocket handlers inside Vercel Functions.

Supabase

Provides:

authentication

PostgreSQL

RLS

organization data

device state

command state

audit data

subscription data

remote session state

Upstash Redis

Used for:

realtime pub/sub coordination

short-lived tickets

distributed command coordination

rolling performance telemetry

Operational Principles

SentinelGrid intentionally avoids several unsafe shortcuts:

no security decisions based only on the browser

no direct exposure of server secrets

no automatic deletion on downgrade

no unsigned Agent update installation

no RDP relay tickets without expiry

no unrestricted remote command execution

no assumption that offline means shutdown succeeded

no fabricated telemetry or version history

no bypass of Agent update version/signature checks

Roadmap

Phase 1 — Core RMM and Monitoring

Authentication

Organizations

Members and invitations

Clients

Sites

Devices

Windows Agent

Heartbeat

Inventory

Device performance

Device Activity

Device Actions

Terminal

Realtime relay

RDP architecture

Alerts

Incidents

Audit logging

Plan / entitlement foundation

Complete premium authorization enforcement

Production billing integration

Production-qualified Agent updates

Production-qualified RDP

Phase 2 — Monitoring Expansion

SSL certificate monitoring

DNS monitoring

domain management

richer monitor history

notification channels

alert rules

Phase 3 — Infrastructure and Security Intelligence

exposed-service detection

port discovery

service identification

vulnerability correlation

security findings

risk scoring

asset criticality

Phase 4 — Platform

reporting

API access

webhooks

integrations

advanced RBAC

custom enterprise limits

production subscription lifecycle automation

Important Development Notes

Before changing authorization:

inspect the existing server-side checks

preserve current RLS boundaries

keep remote safety checks intact

reuse the centralized access layer

do not replace authorization with frontend-only gating

add tests for Free / Pro / Admin / Member / restricted states

verify direct API calls return 401, 403 or 404 appropriately

Before changing billing:

inspect the real Supabase schema

inspect existing constraints

do not assume provider fields are missing

keep billing provider logic isolated

keep account_subscriptions as the application-facing subscription state

Before changing Agent update code:

keep the signed MSI pipeline

do not bypass hash/signature verification

do not manually replace installed binaries

qualify lifecycle changes in an isolated Windows VM

Brand

Canonical brand assets live under:

public/logos/

Primary assets include:

sentinelgrid-mark.svg
sentinelgrid-wordmark.svg
sentinelgrid-logo.svg

UI branding should use the shared brand component rather than duplicating logo markup.

Vision

SentinelGrid aims to become a single operational interface where IT teams can answer:

What infrastructure do we manage?

What is online?

What changed?

What failed?

What needs attention?

What can we safely do remotely?

What should be fixed first?

The long-term goal is to combine infrastructure monitoring, remote management and security visibility without forcing teams to jump between disconnected tools.

<div align="center">

🛡️ SentinelGrid

Visibility. Control. Security.

Built for modern infrastructure.

</div>