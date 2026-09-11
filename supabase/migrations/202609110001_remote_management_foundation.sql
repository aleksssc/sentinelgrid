begin;
alter table public.devices add column if not exists capabilities jsonb not null default '{}'::jsonb;
alter table public.devices add column if not exists last_inventory_at timestamptz;

create table if not exists public.device_commands (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade,
 requested_by uuid not null references auth.users(id),
 command_type text not null check (command_type in ('update_agent','reboot','shutdown','lock','restart_agent','force_inventory','flush_dns','gpupdate')),
 payload jsonb not null default '{}'::jsonb,
 idempotency_key text not null,
 status text not null default 'queued' check (status in ('queued','dispatched','acknowledged','running','succeeded','failed','expired')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 dispatched_at timestamptz,
 acknowledged_at timestamptz,
 started_at timestamptz,
 completed_at timestamptz,
 result jsonb,
 error_code text,
 error_message text,
 unique(organization_id,device_id,idempotency_key)
);
create table if not exists public.remote_sessions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 device_id uuid not null references public.devices(id) on delete cascade,
 requested_by uuid not null references auth.users(id),
 session_type text not null check (session_type in ('terminal','rdp')),
 status text not null default 'requested' check (status in ('requested','connecting','active','closed','failed','expired')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 source_metadata jsonb not null default '{}'::jsonb
);

create or replace function public.remote_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.organizations where id=p_org and owner_id=auth.uid())
 or exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and role='admin');
$$;
revoke all on function public.remote_org_admin(uuid) from public, anon;
grant execute on function public.remote_org_admin(uuid) to authenticated,service_role;

alter table public.device_commands enable row level security;
alter table public.remote_sessions enable row level security;
revoke all on public.device_commands,public.remote_sessions from anon,authenticated;
grant select,insert on public.device_commands,public.remote_sessions to authenticated;
grant update(status,dispatched_at) on public.device_commands to authenticated;
grant all on public.device_commands,public.remote_sessions to service_role;
drop policy if exists commands_read on public.device_commands;
create policy commands_read on public.device_commands for select to authenticated using(public.remote_org_admin(organization_id));
drop policy if exists commands_insert on public.device_commands;
create policy commands_insert on public.device_commands for insert to authenticated with check (
 public.remote_org_admin(organization_id) and requested_by=auth.uid() and status='queued'
 and (command_type in ('flush_dns','gpupdate','force_inventory') or auth.jwt()->>'aal'='aal2')
 and expires_at>now() and expires_at<=now()+interval '5 minutes'
 and exists(select 1 from public.devices d join public.clients c on c.id=d.client_id where d.id=device_id and c.organization_id=device_commands.organization_id)
);
drop policy if exists commands_dispatch on public.device_commands;
create policy commands_dispatch on public.device_commands for update to authenticated
 using(public.remote_org_admin(organization_id) and requested_by=auth.uid() and status='queued')
 with check(public.remote_org_admin(organization_id) and requested_by=auth.uid() and status='dispatched');
drop policy if exists sessions_read on public.remote_sessions;
create policy sessions_read on public.remote_sessions for select to authenticated using(public.remote_org_admin(organization_id));
drop policy if exists sessions_insert on public.remote_sessions;
create policy sessions_insert on public.remote_sessions for insert to authenticated with check (
 public.remote_org_admin(organization_id) and requested_by=auth.uid() and session_type='terminal' and status='requested'
 and auth.jwt()->>'aal'='aal2' and expires_at>now() and expires_at<=now()+interval '2 hours'
 and exists(select 1 from public.devices d join public.clients c on c.id=d.client_id where d.id=device_id and c.organization_id=remote_sessions.organization_id)
);
commit;
