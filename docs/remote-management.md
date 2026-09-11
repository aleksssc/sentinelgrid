# Remote management foundation

## Current flow

1. An authenticated owner/admin calls `POST /api/devices/:deviceId/commands`.
2. The server validates organization membership, device ownership, policy, online state, AAL2 for high-risk actions, payload shape and rate limits.
3. A durable `device_commands` row is created in Supabase.
4. A typed message is published to the device Redis channel.
5. The existing realtime agent connection forwards `typed_command` to the Windows agent.
6. The agent validates expiry and idempotency, acknowledges, reports running, executes a fixed action and returns a typed result.
7. The realtime route updates the durable command lifecycle and writes audit events.

Raw shell commands are not accepted by the Quick Actions endpoint.

## Local setup

Apply `supabase/migrations/202609110001_remote_management_foundation.sql` to the Supabase project. Copy `.env.example` to `.env.local` and provide Supabase and Upstash values.

The current web process still provides the existing realtime WebSocket route. A separately deployable Go Relay is still required before production traffic should be moved away from the Vercel realtime path.

## Current action support

Implemented in the typed agent path:

- reboot
- shutdown
- lock (fixed Windows invocation; interactive-session hardening remains)
- flush DNS
- GPUpdate

The following are intentionally explicit failures until their dedicated infrastructure exists:

- restart_agent helper and reconnect confirmation
- force_inventory transport and inventory acknowledgement
- interactive ConPTY terminal
- reverse TCP RDP tunnel and Guacamole gateway

## Security rules

- Members are view-only for remote actions.
- Owner/admin checks happen on the server.
- Reboot, shutdown, lock and agent restart require AAL2.
- Remote tickets are returned once and stored only as SHA-256 hashes in Redis with a 60-second TTL.
- RDP credentials are not accepted by these endpoints and must never be persisted.
- Redis is ephemeral; PostgreSQL is the durable command/session source of truth.
