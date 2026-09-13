import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { WebSocket } from "ws";
import { createRealtimeRelay } from "../relay/realtime-relay.mjs";

const require = createRequire(import.meta.url);
function load(role, dependencies) {
  const source = readFileSync(new URL(`../lib/realtime/${role}-socket.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new Function("require","exports",code)(name=>dependencies[name] ?? require(name),exports);
  return exports;
}
const receive = ws => once(ws,"message").then(([data])=>JSON.parse(data.toString()));

async function fixture(t) {
  const subscriptions = new Map(), presence = new Map(), publishes = [];
  const state = { user:{id:"operator"}, owner:"operator", tokenValid:true, deferredAuth:null };
  const admin = {
    auth:{getUser:async token=>state.deferredAuth ? state.deferredAuth : ({data:{user:token==="test-browser-token" ? state.user : null}})},
    from(table) {
      const records = {
        devices:state.tokenValid ? {id:"device",client_id:"client",agent_id:"agent",hostname:"test-device"} : null,
        clients:{organization_id:"org"}, organizations:{id:"org",owner_id:state.owner}, organization_members:{role:"member"},
      };
      const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:records[table],error:null})};
      return query;
    },
  };
  const pubsub = {
    agentCommandChannel:id=>`agent:${id}`, browserResultChannel:id=>`browser:${id}`, agentPresenceKey:id=>`presence:${id}`,
    async publishRealtimeMessage(channel,payload) {
      publishes.push({channel,payload});
      await subscriptions.get(channel)?.(payload);
    },
    subscribeRealtimeChannel(channel,callback) {
      subscriptions.set(channel,callback);
      let resolve;
      const done=new Promise(r=>{resolve=r;});
      return {done,abort(){subscriptions.delete(channel);resolve();}};
    },
  };
  const dependencies={
    "@supabase/supabase-js":{createClient:()=>admin},
    "../organization-access-core":{
      resolveOrganizationAccessForUser:async (_admin,_organizationId,userId)=>userId === state.owner ? {role:"owner",subscription:{plan:"pro",status:"active"}} : {role:"member",subscription:{plan:"pro",status:"active"}},
      accessHasPermission:(access,permission)=>(access.role === "owner" || access.role === "admin") && permission === "devices.terminal",
      accessHasFeature:(access,feature)=>access.subscription.plan !== "free" && !["restricted","canceled"].includes(access.subscription.status) && feature === "terminal",
    },
    "./redis":{getRedis:()=>({set:async(key,value)=>presence.set(key,value),get:async key=>presence.get(key)})},
    "./pubsub":pubsub,
    "./typed-commands": {
      acceptTypedResult: async () => undefined,
      recoverTypedCommands: async () => {},
      pendingTypedCommands: async () => publishes.filter((entry) => entry.payload.type === "typed_command").map((entry) => entry.payload),
    },
  };
  const oldURL=process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://isolated.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-test-service-key";
  const relay=createRealtimeRelay({allowedOrigin:"https://app.example",agent:load("agent",dependencies).attachAgentSocket,browser:load("browser",dependencies).attachBrowserSocket});
  relay.server.listen(0,"127.0.0.1"); await once(relay.server,"listening");
  t.after(async()=>{
    await relay.close();
    if(oldURL===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=oldURL;
    if(oldKey===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  });
  const base=`ws://127.0.0.1:${relay.server.address().port}/api/realtime/`;
  async function socket(role) {
    const ws=new WebSocket(base+role,{headers:role==="browser" ? {Origin:"https://app.example"} : {}});
    await once(ws,"open"); return ws;
  }
  async function authenticate(role, auth) {
    const ws=await socket(role), authenticated=receive(ws);
    ws.send(JSON.stringify(auth)); return {ws,message:await authenticated};
  }
  return {state,pubsub,publishes,subscriptions,socket,authenticate};
}

test("shared handlers preserve terminal dispatch, output, ping, typed commands and RDP notification",{timeout:5000},async t=>{
  const f=await fixture(t);
  const agent=await f.authenticate("agent",{type:"agent_auth",agent_token:"test-agent-token",device_id:"device",agent_id:"agent"});
  assert.equal(agent.message.type,"authenticated");
  const browser=await f.authenticate("browser",{type:"browser_auth",access_token:"test-browser-token",device_id:"device"});
  assert.equal(browser.message.type,"browser_authenticated"); assert.equal(browser.message.online,true);
  const command=receive(agent.ws), accepted=receive(browser.ws);
  browser.ws.send(JSON.stringify({type:"command",shell:"cmd",command:"echo sentinelgrid-realtime-test"}));
  const forwarded=await command;
  assert.equal(forwarded.type,"command"); assert.equal(forwarded.command,"echo sentinelgrid-realtime-test");
  assert.equal((await accepted).command_id,forwarded.command_id);
  const output=receive(browser.ws);
  agent.ws.send(JSON.stringify({type:"command_result",session_id:forwarded.session_id,command_id:forwarded.command_id,stdout:"sentinelgrid-realtime-test",stderr:"",exit_code:0}));
  const result=await output;
  assert.equal(result.stdout,"sentinelgrid-realtime-test"); assert.equal(result.device_id,"device"); assert.equal(result.exit_code,0);
  for(const peer of [agent,browser]) {
    const pong=receive(peer.ws);peer.ws.send('{"type":"ping"}');assert.equal((await pong).type,"pong");
  }
  for(const payload of [{type:"rdp_available"},{type:"typed_command",command_id:"typed-test",command_type:"flush_dns",payload:{},idempotency_key:"unique-test",created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()}]) {
    const message=receive(agent.ws);await f.pubsub.publishRealtimeMessage("agent:device",payload);assert.deepEqual(await message,payload);
  }
  const closes=[once(agent.ws,"close"),once(browser.ws,"close")];agent.ws.close();browser.ws.close();await Promise.all(closes);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.subscriptions.size,0);
});

test("shared handlers reject unauthenticated, wrong-device and wrong-role clients",{timeout:5000},async t=>{
  const f=await fixture(t);
  for(const [role,auth,code] of [
    ["agent",{type:"ping"},4401],
    ["agent",{type:"agent_auth",agent_token:"test-agent-token",device_id:"wrong-device"},4403],
    ["browser",{type:"browser_auth",access_token:"wrong-token",device_id:"device"},4401],
  ]) {
    const ws=await f.socket(role),closed=once(ws,"close");ws.send(JSON.stringify(auth));assert.equal((await closed)[0],code);
  }
  f.state.owner="another-user";
  const ws=await f.socket("browser"),closed=once(ws,"close");
  ws.send(JSON.stringify({type:"browser_auth",access_token:"test-browser-token",device_id:"device"}));
  assert.equal((await closed)[0],4403);assert.equal(f.subscriptions.size,0);
});

test("authentication completing after disconnect cannot leak a subscription",{timeout:5000},async t=>{
  const f=await fixture(t);
  let finishAuth;
  f.state.deferredAuth=new Promise(resolve=>{finishAuth=resolve;});
  const ws=await f.socket("browser");
  ws.send(JSON.stringify({type:"browser_auth",access_token:"test-browser-token",device_id:"device"}));
  await new Promise(resolve=>setTimeout(resolve,20));
  const closed=once(ws,"close");ws.close();await closed;
  finishAuth({data:{user:{id:"operator"}}});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.subscriptions.size,0);
});
