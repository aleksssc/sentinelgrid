import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const compile=(path)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(path,require){const module={exports:{}};new Function("require","module","exports",compile(path))(require,module,module.exports);return module.exports;}
const policy=load("../lib/agent/update-policy.ts",()=>{throw new Error("unexpected import");});
const artifact=load("../lib/agent/product-release.ts",(name)=>{if(name==="node:crypto")return{createHash};throw new Error(name);});
class APIError extends Error{constructor(code,status){super(code);this.status=status;}}
function fixture({compatible=true,automatic=true,capability=true}={}){
 const manifest={schema_version:1,product:"SentinelGridAgent",version:"0.1.9",channel:"beta",platform:"windows",architecture:"amd64",signed:true,development_update_build:true,installation_artifact:"msi",update_protocol:2,trusted_signer_sha256:["A".repeat(64)]};
 for(const[key,filename]of Object.entries({agent:"SentinelGridAgent.exe",updater:"SentinelGridUpdater.exe",rdp_client:"SentinelGridRDP.exe",msi:"SentinelGridAgent.msi"}))manifest[key]={filename,version:"0.1.9",sha256:"a".repeat(64),size:42};
 const bytes=Buffer.from(JSON.stringify(manifest));
 const release={id:"trusted-release",version:"0.1.9",channel:"beta",platform:"windows",architecture:"amd64",storage_path:"beta/0.1.9/SentinelGridAgent.exe",sha256:"a".repeat(64),size_bytes:42,msi_sha256:"a".repeat(64),msi_size_bytes:42,manifest_sha256:createHash("sha256").update(bytes).digest("hex"),signer_sha256:"A".repeat(64)};
 const events=[];
 const admin={rpc:async(name,args)=>{events.push([name,args]);return{data:true};},from:(table)=>{
  const chain={select:()=>chain,eq:(...args)=>{events.push([table,...args]);return chain;},lte:()=>chain,limit:async()=>({data:[release]}),maybeSingle:async()=>({data:{channel:"beta",automatic_updates:automatic,update_delay_hours:0}}),upsert:async()=>({error:null})};return chain;
 },storage:{from:()=>({download:async(path)=>{events.push(["manifest",path]);return{data:new Blob([bytes])};},createSignedUrl:async(path)=>{events.push(["sign",path]);return{data:{signedUrl:`https://isolated.example/${path}`}};}})}};
 const route=load("../app/api/agent/update/check/route.ts",(name)=>{
  if(name.endsWith("update-auth"))return{authenticateUpdateAgent:async()=>({admin,device:{id:"trusted-device",agent_version:"0.1.8",capabilities:{agent_update:capability}},organizationId:"trusted-org"}),UpdateAPIError:APIError,updateErrorResponse:(error)=>Response.json({error:error.message},{status:error.status??500})};
  if(name.endsWith("update-policy"))return policy;if(name.endsWith("product-release"))return artifact;throw new Error(name);
 });
 const request=new Request("https://app.example/api/agent/update/check",{method:"POST",headers:compatible?{"X-SentinelGrid-Update-Protocol":"2"}:{},body:JSON.stringify({organization_id:"attacker-org",current_version:"0.0.1",download_url:"https://attacker.example/evil.msi",sha256:"b".repeat(64)})});
 return{events,route,request,release};
}
async function withEnvironment(run){const oldEnabled=process.env.SENTINELGRID_AGENT_UPDATES_ENABLED,oldURL=process.env.NEXT_PUBLIC_SUPABASE_URL;process.env.SENTINELGRID_AGENT_UPDATES_ENABLED="true";process.env.NEXT_PUBLIC_SUPABASE_URL="https://isolated.example";try{await run();}finally{for(const[key,value]of[["SENTINELGRID_AGENT_UPDATES_ENABLED",oldEnabled],["NEXT_PUBLIC_SUPABASE_URL",oldURL]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}}
test("legacy clients fail closed without generating an EXE or MSI download",()=>withEnvironment(async()=>{
 const f=fixture({compatible:false});const response=await f.route.POST(f.request);assert.equal(response.status,200);const body=await response.json();assert.equal(body.installation_enabled,false);assert.equal(body.bootstrap_required,true);assert.equal(body.download_url,undefined);assert.ok(!f.events.some(([key])=>["manifest","sign"].includes(key)));
}));
test("trusted MSI API ignores client organization/version/artifact and exposes policy",()=>withEnvironment(async()=>{
 const f=fixture({automatic:false});const response=await f.route.POST(f.request);assert.equal(response.status,200);const body=await response.json();assert.equal(body.current_version,"0.1.8");assert.equal(body.latest_version,"0.1.9");assert.equal(body.artifact_type,"msi");assert.equal(body.automatic_updates,false);assert.equal(body.installation_enabled,true);assert.equal(body.sha256,f.release.msi_sha256);assert.equal(body.signer_sha256,f.release.signer_sha256);assert.match(body.download_url,/SentinelGridAgent\.msi$/);assert.ok(f.events.some((event)=>event.includes("trusted-org")));assert.ok(!f.events.flat().includes("attacker-org"));
}));
test("missing capability and changed manifest cannot dispatch",()=>withEnvironment(async()=>{
 const unsupported=fixture({capability:false});const body=await(await unsupported.route.POST(unsupported.request)).json();assert.equal(body.installation_enabled,false);assert.equal(body.download_url,undefined);
 const corrupt=fixture();corrupt.release.manifest_sha256="b".repeat(64);const response=await corrupt.route.POST(corrupt.request);assert.equal(response.status,503);assert.ok(!corrupt.events.some(([key])=>key==="sign"));
}));
