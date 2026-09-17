import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRealtimeRelay } from "../relay/realtime-relay.mjs";

const require=createRequire(import.meta.url);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition) {
  const deadline=Date.now()+3000;
  while(!condition()) { assert.ok(Date.now()<deadline,"condition timed out");await delay(10); }
}

// Local HTTP doubles exercise the compiled handlers and real Supabase/Upstash SDKs.
// No OS action, hosted database, hosted Redis or installed Agent is invoked.
test("compiled handlers share Redis across hosts, preserve all actions and recover without duplicate execution authorization",{timeout:15000},async t=>{
  const channels=new Map(), presence=new Map(), ttls=[], queries=[];
  const rows={
    devices:[{id:"device",agent_id:"agent",client_id:"client",hostname:"isolated",agent_token_hash:createHash("sha256").update("synthetic-agent-token").digest("hex")}],
    clients:[{id:"client",organization_id:"org"}], organizations:[{id:"org",owner_id:"operator"}],
    organization_members:[],organization_subscriptions:[{organization_id:"org",plan:"pro",status:"active"}],device_commands:[],audit_logs:[],
  };
  let failProgress=false;
  const backend=createServer(async(request,response)=>{
    try {
      const url=new URL(request.url,"http://localhost");
      if(url.pathname.startsWith("/subscribe/")) {
        assert.equal(request.headers.authorization,"Bearer synthetic-redis-token");
        const channel=decodeURIComponent(url.pathname.slice("/subscribe/".length));
        const clients=channels.get(channel) ?? new Set();channels.set(channel,clients);clients.add(response);
        response.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store"});
        response.write(`data: subscribe,${channel},1\n\n`);
        response.on("close",()=>{clients.delete(response);if(!clients.size) channels.delete(channel);});
        return;
      }
      let text="";for await(const chunk of request) text+=chunk;
      const json=value=>{response.setHeader("Content-Type","application/json");response.end(JSON.stringify(value));};
      if(url.pathname === "/auth/v1/user") {
        const allowed=request.headers.authorization === "Bearer synthetic-browser-token";
        response.statusCode=allowed ? 200 : 401;
        json(allowed ? {id:"operator",aud:"authenticated",role:"authenticated",email:"operator@example.invalid"} : {message:"invalid token"});return;
      }
      if(url.pathname.startsWith("/rest/v1/")) {
        assert.equal(request.headers.apikey,"synthetic-service-key");
        const table=url.pathname.slice("/rest/v1/".length);
        assert.ok(table in rows,`unexpected table: ${table}`);
        queries.push({table,method:request.method,search:url.search});
        if(failProgress && table === "device_commands" && request.method === "PATCH") {
          response.statusCode=503;json({code:"TEST_OUTAGE",message:"simulated persistence outage"});return;
        }
        let found=rows[table].filter(row=>[...url.searchParams].every(([key,filter])=>{
          if(["select","order","limit","on_conflict"].includes(key)) return true;
          if(filter.startsWith("eq.")) return String(row[key]) === filter.slice(3);
          if(filter === "is.null") return row[key] == null;
          if(filter.startsWith("in.(")) return filter.slice(4,-1).split(",").includes(row[key]);
          if(filter.startsWith("gt.")) return row[key] > filter.slice(3);
          throw new Error(`unsupported filter ${key}`);
        })).slice(0,Number(url.searchParams.get("limit") ?? Infinity));
        if(request.method === "PATCH") {
          const changes=JSON.parse(text);for(const row of found) Object.assign(row,changes);
        } else if(request.method === "POST") {
          const value=JSON.parse(text),existing=rows[table].find(row=>row.id === value.id);
          if(!existing) rows[table].push(value);
          found=[existing ?? value];
        }
        json(found);return;
      }
      assert.equal(request.headers.authorization,"Bearer synthetic-redis-token");
      function redis(command) {
        const [operation,key,value,...options]=command;
        switch(String(operation).toLowerCase()) {
          case "set": {
            const expiry=options.findIndex(option=>String(option).toLowerCase() === "ex");
            ttls.push(options[expiry+1]);presence.set(key,value);return "OK";
          }
          case "get": return presence.get(key) ?? null;
          case "publish": {
            const clients=channels.get(key) ?? [];
            for(const client of clients) client.write(`data: message,${key},${value}\n\n`);
            return clients.size ?? 0;
          }
          default: throw new Error(`unexpected Redis operation ${operation}`);
        }
      }
      const commands=JSON.parse(text);
      json(url.pathname === "/pipeline" ? commands.map(command=>({result:redis(command)})) : {result:redis(commands)});
    } catch(error) {
      response.statusCode=500;response.end("test backend failure");
      assert.fail(error.message);
    }
  });
  backend.listen(0,"127.0.0.1");await once(backend,"listening");
  const origin=`http://127.0.0.1:${backend.address().port}`;
  const env={NEXT_PUBLIC_SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-key",UPSTASH_REDIS_KV_REST_API_URL:origin,UPSTASH_REDIS_KV_REST_API_TOKEN:"synthetic-redis-token"};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));Object.assign(process.env,env);
  const relays=[];
  t.after(async()=>{
    await Promise.all(relays.map(relay=>relay.close()));
    for(const clients of channels.values()) for(const response of clients) response.destroy();
    await new Promise(resolve=>backend.close(resolve));
    for(const [key,value] of Object.entries(previous)) {if(value===undefined) delete process.env[key];else process.env[key]=value;}
  });
  const {attachAgentSocket}=require("../dist/realtime/lib/realtime/agent-socket.js");
  const {attachBrowserSocket}=require("../dist/realtime/lib/realtime/browser-socket.js");
  const {publishRealtimeMessage,agentCommandChannel,browserResultChannel,agentPresenceKey}=require("../dist/realtime/lib/realtime/pubsub.js");
  const {DEVICE_ACTIONS}=require("../dist/realtime/lib/remote/action-definitions.js");
  for(let index=0;index<2;index++) {
    const relay=createRealtimeRelay({agent:attachAgentSocket,browser:attachBrowserSocket,allowedOrigin:"https://app.example"});
    relays.push(relay);relay.server.listen(0,"127.0.0.1");await once(relay.server,"listening");
  }
  async function socket(index,role,auth) {
    const ws=new WebSocket(`ws://127.0.0.1:${relays[index].server.address().port}/api/realtime/${role}`,{headers:role === "browser" ? {Origin:"https://app.example"} : {}});
    const messages=[];ws.on("message",raw=>messages.push(JSON.parse(raw.toString())));
    await once(ws,"open");
    ws.send(JSON.stringify(auth ?? (role === "agent" ? {type:"agent_auth",agent_token:"synthetic-agent-token",device_id:"device",agent_id:"agent"} : {type:"browser_auth",access_token:"synthetic-browser-token",device_id:"device"})));
    return {ws,messages,async take(type,id) {
      const match=message=>message.type === type && (!id || message.command_id === id);
      await until(()=>messages.some(match));return messages.splice(messages.findIndex(match),1)[0];
    }};
  }
  for(const credentials of [
    {agent_token:"invalid",device_id:"device",agent_id:"agent"},
    {agent_token:"synthetic-agent-token",device_id:"wrong",agent_id:"agent"},
    {agent_token:"synthetic-agent-token",device_id:"device",agent_id:"wrong"},
  ]) {
    const peer=await socket(0,"agent",{type:"agent_auth",...credentials});
    const [code]=await once(peer.ws,"close");assert.equal(code,credentials.agent_token === "invalid" ? 4401 : 4403);
  }
  let agent=await socket(0,"agent");await agent.take("authenticated");
  const browser=await socket(1,"browser"),auth=await browser.take("browser_authenticated");
  assert.equal(auth.online,true);assert.ok(ttls.every(ttl=>ttl === 45));
  await until(()=>channels.has(agentCommandChannel("device")) && channels.has(browserResultChannel(auth.session_id)));
  assert.ok(queries.some(query=>query.search.includes("agent_token_hash=eq."+createHash("sha256").update("synthetic-agent-token").digest("hex"))));
  for(const shell of ["cmd","powershell"]) {
    browser.ws.send(JSON.stringify({type:"command",shell,command:"echo simulated"}));
    const forwarded=await agent.take("command");assert.equal(forwarded.shell,shell);
    assert.equal((await browser.take("command_accepted")).command_id,forwarded.command_id);
    agent.ws.send(JSON.stringify({type:"command_result",command_id:forwarded.command_id,session_id:forwarded.session_id,stdout:"simulated",stderr:"",exit_code:0}));
    assert.equal((await browser.take("command_result")).stdout,"simulated");
  }
  for(const peer of [agent,browser]) {peer.ws.send('{"type":"ping"}');await peer.take("pong");}
  await publishRealtimeMessage(agentCommandChannel("device"),{type:"rdp_available"});await agent.take("rdp_available");
  function command(id,type="flush_dns") {
    const row={id,device_id:"device",organization_id:"org",requested_by:"operator",command_type:type,status:"queued",payload:{},result:{},idempotency_key:id,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};
    rows.device_commands.push(row);return row;
  }
  async function progress(peer,row,type,status) {
    peer.ws.send(JSON.stringify({type,command_id:row.id,status,result:{exit_code:0}}));
    assert.equal((await peer.take("typed_command_receipt",row.id)).status,status);assert.equal(row.status,status);
  }
  for(const {type} of DEVICE_ACTIONS) {
    const row=command("test-"+type,type);
    await publishRealtimeMessage(agentCommandChannel("device"),{type:"typed_command",command_id:row.id,command_type:"tampered",payload:{command:"untrusted"}});
    const delivered=await agent.take("typed_command",row.id);
    assert.equal(delivered.command_type,type);assert.deepEqual(delivered.payload,{});
    await progress(agent,row,"typed_command_ack","acknowledged");
    await progress(agent,row,"typed_command_running","running");
    await progress(agent,row,"typed_command_result","succeeded");
    await progress(agent,row,"typed_command_result","succeeded");
    assert.equal(rows.audit_logs.filter(audit=>audit.id === row.id).length,1);
  }
  const pending=command("reconnect-pending");
  const oldPresence=presence.get(agentPresenceKey("device"));
  let closed=once(agent.ws,"close");agent.ws.close();await closed;
  await until(()=>!channels.has(agentCommandChannel("device")));
  agent=await socket(1,"agent");await agent.take("authenticated");await agent.take("typed_command",pending.id);
  assert.notEqual(presence.get(agentPresenceKey("device")),oldPresence);
  await progress(agent,pending,"typed_command_ack","acknowledged");
  failProgress=true;
  agent.ws.send(JSON.stringify({type:"typed_command_running",command_id:pending.id,status:"running"}));
  await delay(100);
  assert.equal(pending.status,"acknowledged");assert.ok(!agent.messages.some(message=>message.type === "typed_command_receipt"));
  failProgress=false;
  await progress(agent,pending,"typed_command_running","running");
  await progress(agent,pending,"typed_command_result","succeeded");
  const correlated=command("correlated-update","update_agent");correlated.update_transaction_id="existing-transaction";correlated.status="running";
  agent.ws.send(JSON.stringify({type:"typed_command_result",command_id:correlated.id,status:"succeeded"}));
  await delay(50);assert.equal(correlated.status,"running");
  assert.ok(!agent.messages.some(message=>message.command_id === correlated.id));
  await until(()=>channels.has(agentCommandChannel("device")));
  closed=once(agent.ws,"close");
  for(const stream of channels.get(agentCommandChannel("device"))) stream.end();
  assert.equal((await closed)[0],1011);
  await until(()=>!channels.has(agentCommandChannel("device")));
  agent=await socket(0,"agent");await agent.take("authenticated");
  await until(()=>channels.has(agentCommandChannel("device")));
  await progress(agent,pending,"typed_command_result","succeeded");
  assert.equal(rows.audit_logs.filter(audit=>audit.id === pending.id).length,1);
  assert.ok(!agent.messages.some(message=>message.type === "typed_command" && message.command_id === pending.id));
});
