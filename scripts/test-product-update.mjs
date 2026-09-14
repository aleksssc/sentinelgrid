import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { validateManifest } from "./publish-agent.mjs";
const source = readFileSync(new URL("../lib/agent/product-release.ts",import.meta.url),"utf8");
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {productArtifact}=await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");
function fixture(){
 const manifest={schema_version:1,product:"SentinelGridAgent",version:"0.1.9",channel:"beta",platform:"windows",architecture:"amd64",signed:true,development_update_build:true,installation_artifact:"msi",update_protocol:2,trusted_signer_sha256:["A".repeat(64)],server_url:"https://isolated.example"};
 for(const [key,filename]of Object.entries({agent:"SentinelGridAgent.exe",updater:"SentinelGridUpdater.exe",rdp_client:"SentinelGridRDP.exe",native_video:"SentinelGridVideo.dll",msi:"SentinelGridAgent.msi"}))manifest[key]={filename,version:"0.1.9",sha256:(key==="msi"?"b":"a").repeat(64),size:42};
 const release={version:"0.1.9",channel:"beta",msi_sha256:"b".repeat(64),msi_size_bytes:42,signer_sha256:"A".repeat(64)};
 return{manifest,release};
}
function encode(manifest,release){const bytes=Buffer.from(JSON.stringify(manifest));return[{...release,manifest_sha256:hash(bytes)},bytes];}
test("remote installation metadata selects only the complete MSI",()=>{
 const {manifest,release}=fixture();const artifact=productArtifact(...encode(manifest,release));
 assert.equal(artifact.storage_path,"beta/0.1.9/SentinelGridAgent.msi");assert.equal(artifact.sha256,release.msi_sha256);assert.equal(artifact.update_protocol,2);assert.equal(artifact.artifact_type,"msi");
});
for(const key of ["agent","updater","rdp_client","native_video","msi"])test(`publication and delivery reject mixed ${key} version`,()=>{
 const{manifest,release}=fixture();manifest[key].version="0.1.5";
 assert.throws(()=>validateManifest(manifest,"0.1.9","beta",release.signer_sha256));assert.throws(()=>productArtifact(...encode(manifest,release)));
});
test("delivery rejects tampering, unqualified MSI, unsigned and wrong signer metadata",()=>{
 for(const mutate of [m=>m.signed=false,m=>m.update_protocol=1,m=>m.installation_artifact="agent",m=>m.development_repair_package=true,m=>m.trusted_signer_sha256=["C".repeat(64)],m=>m.msi.sha256="c".repeat(64),m=>m.msi.size=43]){
  const{manifest,release}=fixture();mutate(manifest);assert.throws(()=>productArtifact(...encode(manifest,release)));
 }
 const{manifest,release}=fixture();const[metadata,bytes]=encode(manifest,release);bytes[0]=32;assert.throws(()=>productArtifact(metadata,bytes));
});
test("both triggers converge before download and old agents never receive an MSI URL",()=>{
 const checker=readFileSync(new URL("../agent/internal/update/checker_windows.go",import.meta.url),"utf8");
 assert.match(checker,/host\.InstallRelease\(ctx, version, "", ready\)/);assert.match(checker,/host\.InstallRelease\(ctx, buildinfo\.Version\(\), commandID, true\)/);
 assert.ok(!checker.includes('"candidate.exe"'));assert.match(checker,/time\.Minute \+ startup/);assert.match(checker,/5\*time\.Hour \+ extra/);
 const api=readFileSync(new URL("../app/api/agent/update/check/route.ts",import.meta.url),"utf8");
 const rejectIndex=api.search(/if\s*\(\s*!release\s*\|\|\s*!enabled\s*\|\|\s*!capability\s*\|\|\s*!compatible\s*\)/);const signIndex=api.search(/storage\s*\.createSignedUrl\s*\(\s*artifact\.storage_path/);assert.ok(rejectIndex>=0&&signIndex>rejectIndex);
});
test("MSI preserves enrollment, retains Windows Installer rollback and includes all binaries",()=>{
 const wix=readFileSync(new URL("../installer/windows/Package.wxs",import.meta.url),"utf8");
 for(const component of ["Agent","Updater","RDP","Video"])assert.match(wix,new RegExp(`ComponentRef Id="SentinelGrid${component}Component"`));
 assert.match(wix,/MajorUpgrade\s+Schedule="afterInstallExecute"/);
 assert.match(wix,/Condition="NOT Installed AND NOT WIX_UPGRADE_DETECTED AND NOT SG_EXISTING_CONFIG"/);
 assert.ok(!/<(?:File|RemoveFile|RemoveFolder)\b[^>]*(?:agent\.json|CommonAppDataFolder)/.test(wix));
 assert.match(wix,/ExeCommand="-maintenance-rollback"\s+Execute="rollback"/);
});
