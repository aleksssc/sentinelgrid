begin;
create table if not exists public.agent_releases (
 id uuid primary key default gen_random_uuid(),
 version text not null check (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
 channel text not null check (channel in ('dev','beta','stable')),
 platform text not null default 'windows' check (platform='windows'),
 architecture text not null default 'amd64' check (architecture='amd64'),
 storage_path text not null,
 sha256 text not null check (sha256 ~ '^[a-fA-F0-9]{64}$'),
 size_bytes bigint not null check (size_bytes between 1 and 268435456),
 published_at timestamptz not null default now(),
 is_active boolean not null default false,
 created_by uuid references auth.users(id),
 release_notes text,
 unique(channel,version,platform,architecture),
 check(storage_path=channel || '/' || version || '/SentinelGridAgent.exe')
);
create table if not exists public.organization_agent_update_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 automatic_updates boolean not null default true,
 channel text not null default 'stable' check(channel in ('dev','beta','stable')),
 update_delay_hours integer not null default 0 check(update_delay_hours between 0 and 8760)
);
create table if not exists public.device_agent_update_state (
 device_id uuid primary key references public.devices(id) on delete cascade,
 latest_version text,
 effective_channel text check(effective_channel in ('dev','beta','stable')),
 last_check_at timestamptz,
 last_check_claim_at timestamptz,
 last_report_at timestamptz,
 report_window_at timestamptz,
 report_count integer not null default 0,
 update_status text,
 update_target_version text,
 update_error text,
 update_started_at timestamptz,
 update_completed_at timestamptz,
 failed_version text,
 transaction_id uuid
);
alter table public.device_commands add column if not exists update_transaction_id uuid;
create table if not exists public.agent_update_transactions (
 id uuid primary key,
 device_id uuid not null references public.devices(id) on delete cascade,
 command_id uuid references public.device_commands(id),
 target_version text not null,
 status text not null,
 error_code text,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table public.device_agent_update_state add column if not exists transaction_id uuid;
alter table public.agent_update_transactions add column if not exists error_code text;
alter table public.device_commands add column if not exists update_target_version text;
create unique index if not exists one_active_agent_update on public.agent_update_transactions(device_id) where completed_at is null;

alter table public.agent_releases enable row level security;
alter table public.organization_agent_update_settings enable row level security;
alter table public.device_agent_update_state enable row level security;
alter table public.agent_update_transactions enable row level security;
revoke all on public.agent_releases,public.organization_agent_update_settings,public.device_agent_update_state,public.agent_update_transactions from anon,authenticated;
grant select on public.agent_releases,public.organization_agent_update_settings,public.device_agent_update_state to authenticated;
grant insert,update on public.organization_agent_update_settings to authenticated;
grant all on public.agent_releases,public.organization_agent_update_settings,public.device_agent_update_state,public.agent_update_transactions to service_role;
drop policy if exists releases_read on public.agent_releases;
create policy releases_read on public.agent_releases for select to authenticated using(is_active);
drop policy if exists update_settings_read on public.organization_agent_update_settings;
create policy update_settings_read on public.organization_agent_update_settings for select to authenticated using(public.remote_org_admin(organization_id));
drop policy if exists update_settings_insert on public.organization_agent_update_settings;
create policy update_settings_insert on public.organization_agent_update_settings for insert to authenticated with check(public.remote_org_admin(organization_id) and auth.jwt()->>'aal'='aal2');
drop policy if exists update_settings_write on public.organization_agent_update_settings;
create policy update_settings_write on public.organization_agent_update_settings for update to authenticated using(public.remote_org_admin(organization_id)) with check(public.remote_org_admin(organization_id) and auth.jwt()->>'aal'='aal2');
drop policy if exists update_state_read on public.device_agent_update_state;
create policy update_state_read on public.device_agent_update_state for select to authenticated using(
 exists(select 1 from public.devices d join public.clients c on c.id=d.client_id where d.id=device_id and (
 public.remote_org_admin(c.organization_id) or exists(select 1 from public.organization_members m where m.organization_id=c.organization_id and m.user_id=auth.uid()))));

create or replace function public.claim_agent_update_check(p_device_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.device_agent_update_state(device_id) values(p_device_id) on conflict do nothing;
 update public.device_agent_update_state set last_check_claim_at=now() where device_id=p_device_id
 and (last_check_claim_at is null or last_check_claim_at<now()-interval '1 minute');
 return found;
end $$;

create or replace function public.report_agent_update(p_device_id uuid,p_status text,p_target text,p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 if p_status not in ('checking','available') or (p_error is not null and p_error not in ('CHECK_FAILED','UPDATER_NOT_OPERATIONAL'))
 or (p_target is not null and p_target !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') then raise exception 'Invalid uncorrelated update report'; end if;
 insert into public.device_agent_update_state(device_id) values(p_device_id) on conflict do nothing;
 update public.device_agent_update_state set update_status=p_status,update_target_version=p_target,update_error=p_error,last_report_at=now()
 where device_id=p_device_id and (last_report_at is null or last_report_at<now()-interval '10 seconds')
 and not exists(select 1 from public.agent_update_transactions where device_id=p_device_id and completed_at is null);
 return found;
end $$;

create or replace function public.report_agent_update_transaction(p_device_id uuid,p_status text,p_target text,p_error text,p_transaction_id uuid,p_command_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare tx public.agent_update_transactions; cmd public.device_commands; org uuid; terminal boolean; old_rank integer; new_rank integer;
begin
 if p_transaction_id is null or p_target is null or p_target !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
 or p_status not in ('downloading','staged','installing','restarting','succeeded','failed','rolled_back')
 or (p_error is not null and p_error not in ('CHECK_FAILED','DOWNLOAD_FAILED','VERIFICATION_FAILED','BACKUP_FAILED','INSTALL_OR_HEALTH_FAILED','ROLLBACK_FAILED','UPDATER_NOT_OPERATIONAL')) then raise exception 'Invalid transaction report'; end if;
 select c.organization_id into org from public.devices d join public.clients c on c.id=d.client_id where d.id=p_device_id for update of d;
 if org is null then raise exception 'Unknown device'; end if;
 if p_status='succeeded' and not exists(select 1 from public.devices where id=p_device_id and agent_version=p_target) then raise exception 'Target heartbeat not observed'; end if;
 terminal := p_status in ('succeeded','failed','rolled_back');
 select * into tx from public.agent_update_transactions where id=p_transaction_id for update;
 if found then
  if tx.device_id<>p_device_id or tx.target_version<>p_target or tx.command_id is distinct from p_command_id then raise exception 'Transaction identity mismatch'; end if;
  if tx.completed_at is not null then
   if tx.status=p_status and tx.error_code is not distinct from p_error then return true; end if;
   raise exception 'Transaction already completed';
  end if;
  if tx.status=p_status and tx.error_code is not distinct from p_error then return true; end if;
  old_rank:=array_position(array['downloading','staged','installing','restarting'],tx.status);
  new_rank:=array_position(array['downloading','staged','installing','restarting'],p_status);
  if not terminal and new_rank<old_rank then return true; end if;
 end if;
 insert into public.device_agent_update_state(device_id) values(p_device_id) on conflict do nothing;
 update public.device_agent_update_state set report_count=case when report_window_at is null or report_window_at<now()-interval '1 minute' then 1 else report_count+1 end,
 report_window_at=case when report_window_at is null or report_window_at<now()-interval '1 minute' then now() else report_window_at end
 where device_id=p_device_id and (report_window_at is null or report_window_at<now()-interval '1 minute' or report_count<20);
 if not found then return false; end if;
 if tx.id is null then
  if p_status='succeeded' then raise exception 'Success requires an existing transaction'; end if;
  if p_command_id is not null then
   select * into cmd from public.device_commands where id=p_command_id for update;
   if not found or cmd.device_id<>p_device_id or cmd.organization_id<>org or cmd.command_type<>'update_agent'
    or cmd.update_transaction_id is not null or cmd.status not in ('queued','dispatched','acknowledged','running','expired') or (not terminal and (cmd.expires_at<=now() or cmd.status='expired'))
    then raise exception 'Update command mismatch'; end if;
   update public.device_commands set update_transaction_id=p_transaction_id,update_target_version=p_target,status='running',started_at=coalesce(started_at,now()) where id=p_command_id;
  end if;
  insert into public.agent_update_transactions(id,device_id,command_id,target_version,status)
   values(p_transaction_id,p_device_id,p_command_id,p_target,p_status);
 end if;
 update public.agent_update_transactions set status=p_status,error_code=p_error,completed_at=case when terminal then now() else null end where id=p_transaction_id;
 insert into public.device_agent_update_state(device_id,update_status,update_target_version,update_error,transaction_id,last_report_at,update_started_at,update_completed_at,failed_version)
 values(p_device_id,p_status,p_target,p_error,p_transaction_id,now(),coalesce(tx.created_at,now()),case when terminal then now() end,case when p_status in ('failed','rolled_back') then p_target end)
 on conflict(device_id) do update set update_status=excluded.update_status,update_target_version=excluded.update_target_version,update_error=excluded.update_error,
 transaction_id=excluded.transaction_id,last_report_at=excluded.last_report_at,update_started_at=excluded.update_started_at,update_completed_at=excluded.update_completed_at,
 failed_version=coalesce(excluded.failed_version,public.device_agent_update_state.failed_version);
 if terminal then
  if p_command_id is not null then
   update public.device_commands set status=case when p_status='succeeded' then 'succeeded' else 'failed' end,completed_at=now(),error_code=p_error,
    result=jsonb_build_object('update_status',p_status,'target_version',p_target,'transaction_id',p_transaction_id)
    where id=p_command_id and device_id=p_device_id and update_transaction_id=p_transaction_id;
  end if;
  insert into public.audit_logs(organization_id,user_id,action,target_type,target_id,status,metadata)
   values(org,(select requested_by from public.device_commands where id=p_command_id),'agent.update.'||p_status,'device',p_device_id,
    case when p_status='succeeded' then 'success' else 'failed' end,jsonb_build_object('transactionId',p_transaction_id,'version',p_target,'errorCode',p_error));
 end if;
 return true;
end $$;

create or replace function public.immutable_agent_release() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'is_active'-'release_notes') is distinct from (to_jsonb(old)-'is_active'-'release_notes') then raise exception 'Published artifact metadata is immutable'; end if;
 return new;
end $$;
drop trigger if exists immutable_agent_release on public.agent_releases;
create trigger immutable_agent_release before update on public.agent_releases for each row execute function public.immutable_agent_release();

revoke all on function public.claim_agent_update_check(uuid),public.report_agent_update(uuid,text,text,text),public.report_agent_update_transaction(uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_agent_update_check(uuid),public.report_agent_update(uuid,text,text,text),public.report_agent_update_transaction(uuid,text,text,text,uuid,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit) values('agent-releases','agent-releases',false,268435456)
 on conflict(id) do update set public=false,file_size_limit=268435456;
-- Restrictive policies also exclude this bucket from pre-existing broad client policies.
drop policy if exists agent_release_objects_no_client_read on storage.objects;
create policy agent_release_objects_no_client_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'agent-releases');
drop policy if exists agent_release_objects_no_client_insert on storage.objects;
create policy agent_release_objects_no_client_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'agent-releases');
drop policy if exists agent_release_objects_no_client_update on storage.objects;
create policy agent_release_objects_no_client_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'agent-releases') with check(bucket_id<>'agent-releases');
drop policy if exists agent_release_objects_no_client_delete on storage.objects;
create policy agent_release_objects_no_client_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'agent-releases');
commit;
