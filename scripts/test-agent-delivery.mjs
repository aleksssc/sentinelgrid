import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
function loadRoute(file, admin) {
 const source = readFileSync(new URL(file, import.meta.url), "utf8");
 const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const exports = {};
 new Function("require", "exports", compiled)((name) => {
  if (name === "@/lib/supabase/admin") return { createAdminClient: () => admin };
  if (name === "@/lib/agent/update-policy") return { effectiveChannel: (ring) => { assert.ok(["stable","beta","dev"].includes(ring)); return ring; } };
  return require(name);
 }, exports);
 return exports;
}
function database(results) {
 const calls = [];
 return { calls, from(table) {
  const call = { table, operations: [] }; calls.push(call);
  const query = new Proxy({}, { get(_, method) {
   if (method === "single" || method === "maybeSingle") return async () => {
    assert.ok(results.length, `unexpected query on ${table}`); return results.shift();
   };
   return (...args) => { call.operations.push([method, ...args]); return query; };
  } });
  return query;
 } };
}
const token = `SG-ENROLL-${"a".repeat(64)}`;
const enrollment = { organization_id: "test-org", expires_at: new Date(Date.now()+600000).toISOString(), used_at: null, revoked_at: null };
const row = (data, error = null) => ({ data, error });

test("website returns private Storage redirect preserving exact enrollment filename and channel", async () => {
 const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
 process.env.NEXT_PUBLIC_SUPABASE_URL = "https://isolated.example";
 try {
  const admin = database([row(enrollment), row({channel:"beta"}), row({release_id:"test-release"}), row({version:"0.1.6",channel:"beta",platform:"windows",architecture:"amd64",is_active:true})]);
  admin.storage = { from(bucket) { assert.equal(bucket,"agent-releases"); return { async createSignedUrl(path, ttl, options) {
   assert.equal(path,"beta/0.1.6/SentinelGridAgent.msi"); assert.ok(ttl > 0 && ttl <=120);
   assert.equal(options.download,`SentinelGridAgent__${token}.msi`);
   return row({signedUrl:`https://isolated.example/storage/v1/object/sign/agent-releases/${path}?download=${options.download}`});
  } }; } };
  const { GET } = loadRoute("../app/api/agent/download/route.ts",admin);
  const response = await GET(new NextRequest(`https://website.example/api/agent/download?token=${token}`));
  assert.equal(response.status,302); assert.equal(response.headers.get("x-sentinelgrid-version"),"0.1.6");
  assert.equal(response.headers.get("x-sentinelgrid-channel"),"beta"); assert.match(response.headers.get("cache-control"),/no-store/);
  assert.equal(response.headers.get("referrer-policy"),"no-referrer"); assert.equal(await response.text(),"");
  assert.ok(admin.calls[0].operations.some(op => op[0] === "eq" && op[1] === "token_hash" && op[2] !== token));
 } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=previous; }
});
for (const field of ["used_at","revoked_at","expires_at"]) test(`website rejects ${field} token before release lookup`, async () => {
 const admin=database([row({...enrollment,[field]:"2020-01-01T00:00:00Z"})]);
 const {GET}=loadRoute("../app/api/agent/download/route.ts",admin);
 const response=await GET(new NextRequest(`https://website.example/api/agent/download?token=${token}`));
 assert.equal(response.status,401); assert.equal(admin.calls.length,1);
});
test("no channel head means no stale public MSI fallback", async () => {
 const admin=database([row(enrollment),row(null),row(null)]);
 const {GET}=loadRoute("../app/api/agent/download/route.ts",admin);
 assert.equal((await GET(new NextRequest(`https://website.example/api/agent/download?token=${token}`))).status,503);
});
test("malformed filename token does not reach database", async () => {
 const admin=database([]); const {GET}=loadRoute("../app/api/agent/download/route.ts",admin);
 assert.equal((await GET(new NextRequest("https://website.example/api/agent/download?token=SG-ENROLL-%22bad"))).status,400);
 assert.equal(admin.calls.length,0);
});
test("heartbeat authenticates and writes metrics/inventory with one database operation", async () => {
 const admin=database([row({id:"test-device",capabilities:{rdp:false}})]);
 const {POST}=loadRoute("../app/api/agent/heartbeat/route.ts",admin);
 const response=await POST(new NextRequest("https://website.example/api/agent/heartbeat",{method:"POST",headers:{Authorization:"Bearer test-token","Content-Type":"application/json"},body:JSON.stringify({rdp_control:true,cpu_usage:0,ram_usage:42,disk_usage:3,uptime_seconds:99,inventory:{agent_version:"0.1.6",capabilities:{rdp:false,terminal:true}}})}));
 assert.equal(response.status,200); assert.deepEqual(await response.json(),{ok:true,device_id:"test-device",rdp_pending:false});
 assert.equal(admin.calls.length,1);
 const ops=admin.calls[0].operations;
 const update=ops.find(op=>op[0]==="update")[1];
 assert.equal(update.cpu_usage,0); assert.equal(update.agent_version,"0.1.6"); assert.equal(update.capabilities.terminal,true);
 assert.ok(ops.some(op=>op[0]==="eq" && op[1]==="agent_token_hash"));
});
test("unknown heartbeat token does not get success or discovery", async () => {
 const admin=database([row(null)]); const {POST}=loadRoute("../app/api/agent/heartbeat/route.ts",admin);
 const response=await POST(new NextRequest("https://website.example/api/agent/heartbeat",{method:"POST",headers:{Authorization:"Bearer invalid"},body:"{}"}));
 assert.equal(response.status,401); assert.equal(admin.calls.length,1);
});
