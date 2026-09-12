import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ids = {
 owner: "10000000-0000-4000-8000-000000000001", outsider: "10000000-0000-4000-8000-000000000002",
 org: "20000000-0000-4000-8000-000000000001", org2: "20000000-0000-4000-8000-000000000002",
 client: "30000000-0000-4000-8000-000000000001", client2: "30000000-0000-4000-8000-000000000002",
 device: "40000000-0000-4000-8000-000000000001", device2: "40000000-0000-4000-8000-000000000002",
 command: "50000000-0000-4000-8000-000000000001", tx: "60000000-0000-4000-8000-000000000001",
};

test("PostgreSQL migrations, RLS, isolated RDP lifecycle and durable update receipts", { timeout: 60000 }, async (t) => {
 const db = new PGlite();
 t.after(() => db.close());
 await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true)) $$;
  grant usage on schema public,auth,storage to anon,authenticated,service_role;
  grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
  create table public.organizations(id uuid primary key,owner_id uuid references auth.users(id));
  create table public.organization_members(organization_id uuid references public.organizations(id),user_id uuid references auth.users(id),role text);
  create table public.clients(id uuid primary key,organization_id uuid references public.organizations(id));
  create table public.devices(id uuid primary key,client_id uuid references public.clients(id),last_seen timestamptz,agent_version text);
  create table public.audit_logs(id uuid default gen_random_uuid(),organization_id uuid,user_id uuid,action text,target_type text,target_id uuid,status text,metadata jsonb);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text);
  alter table storage.objects enable row level security;
  create policy existing_broad_storage_read on storage.objects for select to authenticated using(true);
  grant select on public.organizations,public.organization_members,public.clients,public.devices,storage.objects to authenticated;
  grant all on all tables in schema public,storage to service_role;
 `);
 for (let pass = 0; pass < 2; pass++) for (const name of ["202609110001_remote_management_foundation.sql", "202609110002_rdp.sql", "202609110003_agent_build_and_update.sql", "202609120001_release_publication.sql"]) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8"));
 }
 await db.exec(`
  insert into auth.users values('${ids.owner}'),('${ids.outsider}');
  insert into public.organizations values('${ids.org}','${ids.owner}'),('${ids.org2}','${ids.outsider}');
  insert into public.clients values('${ids.client}','${ids.org}'),('${ids.client2}','${ids.org2}');
  insert into public.devices(id,client_id,last_seen,agent_version,capabilities) values
   ('${ids.device}','${ids.client}',now(),'0.1.5','{"rdp":true,"tcp_tunnel":true,"agent_update":true}'),
   ('${ids.device2}','${ids.client2}',now(),'0.1.5','{}');
  insert into public.organization_remote_access_settings(organization_id,remote_access_enabled,rdp_enabled,max_concurrent_sessions)
   values('${ids.org}',true,true,1);
  insert into storage.objects(bucket_id) values('agent-releases'),('other');
 `);
 const scalar = async (sql, args = []) => Object.values((await db.query(sql,args)).rows[0])[0];
 const asUser = async (user) => db.exec(`set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claim.aal='aal2';`);
 await asUser(ids.outsider);
 await assert.rejects(db.query("select public.create_rdp_session($1,$2,'RDP test')",[ids.device,ids.outsider]));
 await assert.rejects(db.query("select public.claim_agent_update_check($1)",[ids.device]));
 assert.deepEqual((await db.query("select bucket_id from storage.objects")).rows,[{bucket_id:"other"}]);
 await db.exec("reset role; set role service_role;");
 await assert.rejects(db.query("select public.create_rdp_session($1,$2,'RDP test')",[ids.device,ids.outsider]));
 const session = await scalar("select public.create_rdp_session($1,$2,'RDP test')",[ids.device,ids.owner]);
 assert.match(session,/^[a-f0-9-]{36}$/);
 assert.equal(await scalar("select public.create_rdp_session($1,$2,'RDP test')",[ids.device,ids.owner]),null);
 await asUser(ids.outsider);
 assert.equal(await scalar("select count(*) from public.rdp_sessions"),0);
 await assert.rejects(db.query("update public.rdp_sessions set status='closed'"));
 await asUser(ids.owner);
 assert.equal(await scalar("select count(*) from public.rdp_sessions"),1);
 await db.exec("reset role; set role service_role;");
 await db.query("select public.finish_rdp_session($1,'closed')",[session]);
 await db.query("select public.finish_rdp_session($1,'closed')",[session]);
 assert.equal(await scalar("select count(*) from public.audit_logs where action='remote.rdp.closed'"),1);
 assert.equal(await scalar("select public.claim_agent_update_check($1)",[ids.device]),true);
 assert.equal(await scalar("select public.claim_agent_update_check($1)",[ids.device]),false);
 await db.query("insert into public.device_commands(id,organization_id,device_id,requested_by,command_type,idempotency_key,status,expires_at) values($1,$2,$3,$4,'update_agent','update-test','dispatched',now()+interval '5 minutes')",[ids.command,ids.org,ids.device,ids.owner]);
 const report = (device,status,tx=ids.tx,command=ids.command,target="0.1.6") => db.query("select public.report_agent_update_transaction($1,$2,$3,null,$4,$5)",[device,status,target,tx,command]);
 await report(ids.device,"downloading");
 await assert.rejects(report(ids.device2,"staged"));
 await assert.rejects(report(ids.device,"staged",ids.tx,null));
 await assert.rejects(report(ids.device,"staged",ids.tx,ids.command,"0.1.7"));
 await assert.rejects(report(ids.device,"succeeded"));
 await report(ids.device,"staged");
 await report(ids.device,"downloading");
 assert.equal(await scalar("select status from public.agent_update_transactions where id=$1",[ids.tx]),"staged");
 await db.query("update public.devices set agent_version='0.1.6' where id=$1",[ids.device]);
 await report(ids.device,"succeeded");
 await report(ids.device,"succeeded");
 assert.equal(await scalar("select count(*) from public.audit_logs where action='agent.update.succeeded'"),1);
 assert.equal(await scalar("select status from public.device_commands where id=$1",[ids.command]),"succeeded");
 await assert.rejects(report(ids.device,"failed"));
 await db.query("insert into public.agent_releases(version,channel,storage_path,sha256,size_bytes) values('0.1.6','beta','beta/0.1.6/SentinelGridAgent.exe',$1,100)",["a".repeat(64)]);
 await assert.rejects(db.query("update public.agent_releases set size_bytes=200"));
 await db.query("update public.agent_releases set is_active=true");
 await db.query("update public.device_agent_update_state set report_count=19,report_window_at=now() where device_id=$1",[ids.device]);
 const budgetTx="60000000-0000-4000-8000-000000000002";
 assert.equal(await scalar("select public.report_agent_update_transaction($1,'downloading','0.1.7',null,$2,null)",[ids.device,budgetTx]),true);
 assert.equal(await scalar("select public.report_agent_update_transaction($1,'staged','0.1.7',null,$2,null)",[ids.device,budgetTx]),false);
 assert.equal(await scalar("select report_count from public.device_agent_update_state where device_id=$1",[ids.device]),20);
 assert.equal(await scalar("select status from public.agent_update_transactions where id=$1",[budgetTx]),"downloading");
 const stale=await scalar("select public.create_rdp_session($1,$2,'Lease test')",[ids.device,ids.owner]);
 await db.query("update public.rdp_sessions set status='active',relay_seen_at=now()-interval '31 seconds' where id=$1",[stale]);
 assert.ok(await scalar("select public.create_rdp_session($1,$2,'After relay crash')",[ids.device,ids.owner]));
 assert.equal(await scalar("select status from public.rdp_sessions where id=$1",[stale]),"failed");
 const publish = (version, channel='beta', extra={}) => db.query("select public.publish_agent_release($1::jsonb)", [JSON.stringify({version,channel,sha256:'a'.repeat(64),size_bytes:100,msi_sha256:'b'.repeat(64),msi_size_bytes:100,updater_sha256:'c'.repeat(64),updater_size_bytes:100,manifest_sha256:'d'.repeat(64),signer_sha256:'A'.repeat(64),development_build:true,...extra})]);
 await publish('0.1.7');
 assert.equal(await scalar("select r.version from public.agent_release_channels c join public.agent_releases r on r.id=c.release_id where c.channel='beta'"),'0.1.7');
 await assert.rejects(publish('0.1.8','stable'));
 await assert.rejects(publish('0.1.6'));
 await assert.rejects(publish('0.1.7'));
 await assert.rejects(publish('0.1.8','beta',{msi_sha256:'bad'}));
 assert.equal(await scalar("select count(*) from public.agent_releases where version='0.1.8'"),0);
 assert.equal(await scalar("select r.version from public.agent_release_channels c join public.agent_releases r on r.id=c.release_id where c.channel='beta'"),'0.1.7');
 await publish('0.1.8');
 await asUser(ids.owner);
 await assert.rejects(publish('0.1.9'));
 assert.equal(await scalar("select count(*) from public.agent_release_channels").catch(()=>-1),-1);
 await assert.rejects(db.query("update public.agent_releases set is_active=false"));
 await assert.rejects(db.query("update public.device_agent_update_state set update_status='succeeded'"));
});
