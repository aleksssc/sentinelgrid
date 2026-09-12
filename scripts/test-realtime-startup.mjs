import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("../relay/realtime-relay.mjs", import.meta.url));

async function port() {
  const reservation = createServer();
  reservation.listen(0,"127.0.0.1");
  await once(reservation,"listening");
  const value = reservation.address().port;
  await new Promise((resolve,reject)=>reservation.close(error=>error ? reject(error) : resolve()));
  return value;
}

function environment() {
  const env = {...process.env};
  for (const key of Object.keys(env)) if(key.startsWith("SENTINELGRID_REALTIME_")) delete env[key];
  return {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL:"https://test.invalid",
    SUPABASE_SERVICE_ROLE_KEY:"synthetic-test-key",
    UPSTASH_REDIS_KV_REST_API_URL:"https://test.invalid",
    UPSTASH_REDIS_KV_REST_API_TOKEN:"synthetic-test-token",
    SENTINELGRID_REALTIME_BROWSER_ORIGIN:"https://test.invalid",
    SENTINELGRID_REALTIME_BIND:"127.0.0.1",
  };
}

test("compiled standalone entrypoint starts, responds and exits without hosted credentials",{timeout:15000},async t=>{
  const selected = await port();
  const child = spawn(process.execPath,[entrypoint],{
    env:{...environment(),SENTINELGRID_REALTIME_PORT:String(selected)},stdio:["ignore","pipe","pipe"],windowsHide:true,
  });
  const exited = once(child,"exit");
  t.after(async()=>{ if(child.exitCode===null && child.signalCode===null) child.kill(); await exited; });
  let output="";
  child.stdout.on("data",chunk=>{output+=chunk.toString();});
  child.stderr.on("data",chunk=>{output+=chunk.toString();});
  const deadline=Date.now()+10000;
  while(!output.includes("Realtime relay listening") && Date.now()<deadline) {
    if(child.exitCode!==null) assert.fail("standalone process exited before listening: "+output);
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  assert.match(output,/Realtime relay listening/);
  const response=await fetch(`http://127.0.0.1:${selected}/healthz`,{signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,200); assert.equal(await response.text(),"ok");
});

test("entrypoint refuses cleartext public binding",{timeout:5000},async()=>{
  const child=spawn(process.execPath,[entrypoint],{
    env:{...environment(),SENTINELGRID_REALTIME_BIND:"0.0.0.0"},stdio:["ignore","ignore","pipe"],windowsHide:true,
  });
  let error="";child.stderr.on("data",chunk=>{error+=chunk.toString();});
  const [code]=await once(child,"exit");
  assert.equal(code,1);assert.match(error,/startup failed/);
});
