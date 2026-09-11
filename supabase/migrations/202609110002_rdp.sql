begin;

create table if not exists public.organization_remote_access_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  remote_access_enabled boolean not null default false,
  terminal_enabled boolean not null default true,
  rdp_enabled boolean not null default false,
  idle_timeout_minutes integer not null default 15 check (idle_timeout_minutes between 1 and 120),
  max_session_minutes integer not null default 30 check (max_session_minutes between 1 and 120),
  max_concurrent_sessions integer not null default 2 check (max_concurrent_sessions between 1 and 20)
);

create table if not exists public.rdp_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'requested' check (status in ('requested','connecting','active','closed','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  connected_at timestamptz,
  relay_seen_at timestamptz,
  reason text not null check(length(reason) between 3 and 240),
  ended_at timestamptz
);
create index if not exists rdp_sessions_pending on public.rdp_sessions(device_id, created_at) where status = 'requested';
create index if not exists rdp_sessions_active on public.rdp_sessions(organization_id, expires_at) where status in ('requested','connecting','active');

alter table public.rdp_sessions enable row level security;
revoke all on public.rdp_sessions from anon, authenticated;
grant select on public.rdp_sessions to authenticated;
grant all on public.rdp_sessions to service_role;
drop policy if exists rdp_sessions_read on public.rdp_sessions;
create policy rdp_sessions_read on public.rdp_sessions for select to authenticated using (
  exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = auth.uid()) or
  exists (select 1 from public.organization_members m where m.organization_id = rdp_sessions.organization_id and m.user_id = auth.uid() and m.role = 'admin')
);

alter table public.organization_remote_access_settings enable row level security;
grant select on public.organization_remote_access_settings to authenticated;
grant all on public.organization_remote_access_settings to service_role;
drop policy if exists rdp_settings_read on public.organization_remote_access_settings;
create policy rdp_settings_read on public.organization_remote_access_settings for select to authenticated using (
  exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = auth.uid()) or
  exists (select 1 from public.organization_members m where m.organization_id = organization_remote_access_settings.organization_id and m.user_id = auth.uid())
);

create or replace function public.finish_rdp_session(p_session_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.rdp_sessions;
begin
  if p_status not in ('closed','failed') then raise exception 'Invalid RDP terminal state'; end if;
  update public.rdp_sessions set status = p_status, ended_at = now()
    where id = p_session_id and status in ('requested','connecting','active') returning * into s;
  if found then
    insert into public.audit_logs(organization_id,user_id,action,target_type,target_id,status,metadata)
    values (s.organization_id,s.requested_by,'remote.rdp.' || p_status,'device',s.device_id,
      case when p_status = 'failed' then 'failed' else 'success' end,
      jsonb_build_object('sessionId',s.id,'transport','outbound-native-rdp','connectedAt',s.connected_at));
  end if;
end $$;

create or replace function public.create_rdp_session(p_device_id uuid, p_user_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  cfg public.organization_remote_access_settings;
  session_id uuid;
  stale uuid;
begin
  if p_reason is null or length(trim(p_reason)) not between 3 and 240 then raise exception 'RDP reason required'; end if;
  select c.organization_id into org from public.devices d join public.clients c on c.id = d.client_id
    where d.id = p_device_id and d.last_seen > now() - interval '90 seconds'
    and d.last_seen <= now() + interval '30 seconds'
    and d.capabilities @> '{"rdp":true,"tcp_tunnel":true}'::jsonb;
  if org is null then raise exception 'RDP device unavailable'; end if;
  select * into cfg from public.organization_remote_access_settings where organization_id = org for update;
  if not found or not cfg.remote_access_enabled or not cfg.rdp_enabled then raise exception 'RDP disabled'; end if;
  if not exists (select 1 from public.organizations where id = org and owner_id = p_user_id)
    and not exists (select 1 from public.organization_members where organization_id = org and user_id = p_user_id and role = 'admin')
    then raise exception 'RDP forbidden'; end if;
  if cfg.max_session_minutes not between 1 and 120 or cfg.max_concurrent_sessions not between 1 and 20 then
    raise exception 'Invalid RDP policy';
  end if;
  for stale in select id from public.rdp_sessions where organization_id = org and status in ('requested','connecting','active')
    and (expires_at <= now() or (status in ('requested','connecting') and created_at < now() - interval '2 minutes')
      or (status='active' and (relay_seen_at is null or relay_seen_at<now()-interval '30 seconds')))
  loop perform public.finish_rdp_session(stale,'failed'); end loop;
  if exists(select 1 from public.rdp_sessions where device_id=p_device_id and status in ('requested','connecting','active'))
    or ((select count(*) from public.rdp_sessions where organization_id=org and status in ('requested','connecting','active')) +
        (select count(*) from public.remote_sessions where organization_id=org and status in ('requested','connecting','active') and expires_at>now())) >= cfg.max_concurrent_sessions
    then return null; end if;
  insert into public.rdp_sessions(organization_id,device_id,requested_by,expires_at,reason)
    values (org,p_device_id,p_user_id,now() + make_interval(mins => cfg.max_session_minutes),trim(p_reason)) returning id into session_id;
  insert into public.audit_logs(organization_id,user_id,action,target_type,target_id,status,metadata)
    values (org,p_user_id,'remote.rdp.requested','device',p_device_id,'success',jsonb_build_object('sessionId',session_id,'transport','outbound-native-rdp','reason',trim(p_reason)));
  return session_id;
end $$;

revoke all on function public.create_rdp_session(uuid,uuid,text), public.finish_rdp_session(uuid,text) from public, anon, authenticated;
grant execute on function public.create_rdp_session(uuid,uuid,text), public.finish_rdp_session(uuid,text) to service_role;
commit;
