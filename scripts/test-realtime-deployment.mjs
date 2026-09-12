import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { realtimeConfiguration } from "../relay/realtime-config.mjs";
import { createRealtimeRelay } from "../relay/realtime-relay.mjs";

const credentials = {
  NEXT_PUBLIC_SUPABASE_URL:"https://test.invalid", SUPABASE_SERVICE_ROLE_KEY:"synthetic-test-key",
  UPSTASH_REDIS_KV_REST_API_URL:"https://test.invalid", UPSTASH_REDIS_KV_REST_API_TOKEN:"synthetic-test-token",
};

test("relay configuration is opt-in, validates limits and never relaxes production origin checks", () => {
  const defaults = realtimeConfiguration(credentials);
  assert.equal(defaults.host,"127.0.0.1"); assert.equal(defaults.port,8444); assert.equal(defaults.trustProxy,false);
  assert.equal(realtimeConfiguration({...credentials,PORT:"9000"}).port,9000);
  assert.equal(realtimeConfiguration({...credentials,PORT:"9000",SENTINELGRID_REALTIME_PORT:"9001"}).port,9001);
  assert.equal(realtimeConfiguration({...credentials,NODE_ENV:"production"}).allowDevelopmentOrigin,false);
  for (const invalid of [
    {SENTINELGRID_REALTIME_BIND:"0.0.0.0"}, {SENTINELGRID_REALTIME_TRUST_PROXY:"yes"},
    {SENTINELGRID_REALTIME_PORT:""}, {SENTINELGRID_REALTIME_PORT:"65536"}, {SENTINELGRID_REALTIME_MAX_CONNECTIONS:"0"},
    {SENTINELGRID_REALTIME_TLS_CERT:"missing-key.pem"}, {SENTINELGRID_REALTIME_SHUTDOWN_GRACE_MS:"-1"},
    {SENTINELGRID_REALTIME_SHUTDOWN_GRACE_MS:"300001"},
  ]) assert.throws(()=>realtimeConfiguration({...credentials,...invalid}));
  assert.throws(()=>realtimeConfiguration({}),/Missing/);
  assert.equal(realtimeConfiguration({...credentials,SENTINELGRID_REALTIME_BIND:"0.0.0.0",SENTINELGRID_REALTIME_TRUST_PROXY:"true"}).trustProxy,true);
  for (const allowedOrigin of ["http://localhost:3000","http://public.example","https://app.example/","https://app.example/path"]) {
    assert.throws(()=>createRealtimeRelay({allowedOrigin}));
  }
  assert.throws(()=>createRealtimeRelay({allowedOrigin:"http://public.example",allowDevelopmentOrigin:true}));
});

test("native env loading is read-only, gives process env priority and skips implicit files in production/test", t => {
  const root=mkdtempSync(join(tmpdir(),"sentinelgrid-realtime-env-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const local="SG_RELAY_TEST_LOCAL=local\nSG_RELAY_TEST_OVERRIDE=file\n";
  writeFileSync(join(root,".env.local"),local);
  writeFileSync(join(root,".env"),"SG_RELAY_TEST_LOCAL=base\nSG_RELAY_TEST_BASE=base\n");
  writeFileSync(join(root,"explicit.env"),"SG_RELAY_TEST_LOCAL=explicit\n");
  const moduleURL=new URL("../relay/realtime-config.mjs",import.meta.url).href;
  const env={...process.env,SG_RELAY_TEST_OVERRIDE:"process"};
  for (const key of Object.keys(env)) if(key.startsWith("SENTINELGRID_REALTIME_") || key === "SG_RELAY_TEST_LOCAL" || key === "SG_RELAY_TEST_BASE") delete env[key];
  const script=`import {loadRealtimeEnvironment} from ${JSON.stringify(moduleURL)}; loadRealtimeEnvironment(${JSON.stringify(root)}); console.log(JSON.stringify([process.env.SG_RELAY_TEST_LOCAL,process.env.SG_RELAY_TEST_BASE,process.env.SG_RELAY_TEST_OVERRIDE]));`;
  function run(extra) {
    return spawnSync(process.execPath,["--input-type=module","-e",script],{env:{...env,...extra},encoding:"utf8",windowsHide:true,timeout:5000});
  }
  const development=run({NODE_ENV:"development"});
  assert.equal(development.status,0,development.stderr);
  assert.deepEqual(JSON.parse(development.stdout),["local","base","process"]);
  for (const mode of ["production","test"]) {
    const result=run({NODE_ENV:mode}); assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),[null,null,"process"]);
  }
  const explicit=run({NODE_ENV:"production",SENTINELGRID_REALTIME_ENV_FILE:"explicit.env"});
  assert.equal(explicit.status,0,explicit.stderr); assert.deepEqual(JSON.parse(explicit.stdout),["explicit",null,"process"]);
  assert.notEqual(run({SENTINELGRID_REALTIME_ENV_FILE:"not-present.env"}).status,0);
  assert.equal(readFileSync(join(root,".env.local"),"utf8"),local);
});

async function fixture(t, options={}) {
  const echo=ws=>ws.on("message",data=>ws.send(data.toString()));
  const relay=createRealtimeRelay({allowedOrigin:"https://app.example",agent:echo,browser:echo,...options});
  relay.server.listen(0,"127.0.0.1"); await once(relay.server,"listening");
  t.after(()=>relay.close());
  return {...relay,url:`ws://127.0.0.1:${relay.server.address().port}`};
}

test("private proxy requires verified HTTPS forwarding and still validates exact browser origin",{timeout:5000},async t=>{
  const f=await fixture(t,{trustProxy:true});
  for (const headers of [{},{"X-Forwarded-Proto":"http"},{"X-Forwarded-Proto":"https,http"}]) {
    const ws=new WebSocket(f.url+"/api/realtime/agent",{headers}); await once(ws,"error");
  }
  for (const role of ["agent","browser"]) {
    const headers={"X-Forwarded-Proto":"https",...(role === "browser" ? {Origin:"https://app.example"} : {})};
    const ws=new WebSocket(f.url+"/api/realtime/"+role,{headers}); await once(ws,"open");
    const received=once(ws,"message"); ws.send("preserved"); assert.equal((await received)[0].toString(),"preserved");
    const closed=once(ws,"close");ws.close();await closed;
  }
  const rejected=new WebSocket(f.url+"/api/realtime/browser",{headers:{"X-Forwarded-Proto":"https",Origin:"https://evil.example"}});
  await once(rejected,"error");
});

test("explicit local development origin allows the local browser, not other origins",{timeout:5000},async t=>{
  const f=await fixture(t,{allowedOrigin:"http://localhost:3000",allowDevelopmentOrigin:true});
  const ws=new WebSocket(f.url+"/api/realtime/browser",{headers:{Origin:"http://localhost:3000"}});
  await once(ws,"open"); const closed=once(ws,"close");ws.close();await closed;
  const rejected=new WebSocket(f.url+"/api/realtime/browser",{headers:{Origin:"http://localhost:3001"}});
  await once(rejected,"error");
});

test("bounded drain rejects new connections, marks health unavailable and preserves in-flight traffic until deadline",{timeout:5000},async t=>{
  const f=await fixture(t);
  const ws=new WebSocket(f.url+"/api/realtime/agent");await once(ws,"open");
  const closed=once(ws,"close");
  const draining=f.close({graceMs:300}); assert.equal(f.close(),draining);
  const health=await fetch(f.url.replace("ws:","http:")+"/healthz");
  assert.equal(health.status,503); assert.equal(await health.text(),"draining");
  const rejected=new WebSocket(f.url+"/api/realtime/agent");await once(rejected,"error");
  const result=once(ws,"message");ws.send("pending-result");assert.equal((await result)[0].toString(),"pending-result");
  await draining; await closed;
});

test("standalone max payload remains four MiB",{timeout:5000},async t=>{
  const f=await fixture(t,{agent:ws=>ws.on("error",()=>{})});
  const ws=new WebSocket(f.url+"/api/realtime/agent");await once(ws,"open");
  const closed=once(ws,"close");ws.send(Buffer.alloc(4*1024*1024+1));
  assert.equal((await closed)[0],1009);
});
