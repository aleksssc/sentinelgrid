import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once, EventEmitter } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createRDPRelay, RDPAuthorizationError } from "../relay/rdp-relay.mjs";

async function fixture(t, options = {}) {
 const tickets = new Map(), events = [], receipts = [], notification = new EventEmitter();
 let stateError, stateGate;
 const relay = createRDPRelay({ pairMs: 2000, pollMs: 20, ...options,
  diagnostic: event => { events.push(event); notification.emit(event.event, event); },
  authorize: async request => {
   if (request.operation === "finish") { receipts.push(request); return { ok: true }; }
   if (request.operation === "redeem") {
    const identity = tickets.get(request.ticket); tickets.delete(request.ticket);
    if (!identity) throw new RDPAuthorizationError(401, "INVALID_TICKET");
    return identity;
   }
   if (request.operation === "state") {
    if (stateGate) { notification.emit("state_waiting"); await stateGate; }
    if (stateError) throw stateError;
   }
   return { ok: true, idleSeconds: 60 };
  }
 });
 relay.server.listen(0,"127.0.0.1"); await once(relay.server,"listening");
 t.after(() => relay.close());
 const url = `ws://127.0.0.1:${relay.server.address().port}/rdp`;
 function connect(role, sessionId) {
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { role, sessionId, idleSeconds: 60, expiresAt: new Date(Date.now()+(options.lifetimeMs ?? 10000)).toISOString() });
  return new WebSocket(url,{headers:{Authorization:"Bearer "+ticket}});
 }
 async function pair() {
  const id = randomUUID(), client = connect("client",id);
  const readyClient = once(client,"message"); await once(client,"open");
  const agent = connect("agent",id), readyAgent = once(agent,"message");
  await Promise.all([readyClient,readyAgent]);
  return {client,agent};
 }
 return { relay, pair, events, receipts, notification, failState: error => {stateError=error;}, gateState: gate => {stateGate=gate;} };
}

for (const [code,reason,forwarded] of [[1000,"peer_normal_close",1000],[1001,"peer_normal_close",1000],[1011,"peer_abnormal_close",1011]]) {
 test(`peer close ${code} retains classification and safe diagnostics`,{timeout:5000},async t => {
  const f=await fixture(t), {client,agent}=await f.pair();
  const closed=once(agent,"close");client.close(code,"sensitive peer text must not be logged");
  assert.equal((await closed)[0],forwarded);
  const end=f.events.find(e=>e.event==="session_finished");
  assert.equal(end.reason,reason);assert.equal(end.role,"client");assert.equal(end.peer_close_code,code);
  assert.equal(f.receipts.length,1);assert.equal(f.receipts[0].failed,forwarded===1011);
  assert.ok(!JSON.stringify(f.events).includes("sensitive"));
 });
}

test("abrupt socket disappearance is abnormal, not a successful session",{timeout:5000},async t=>{
 const f=await fixture(t),{client,agent}=await f.pair();const closed=once(agent,"close");client.terminate();
 assert.equal((await closed)[0],1011);const end=f.events.find(e=>e.event==="session_finished");
 assert.ok(["peer_socket_error","peer_abnormal_close"].includes(end.reason));assert.equal(end.role,"client");
});

test("backend policy denial is distinguishable and allowlisted",{timeout:5000},async t=>{
 const f=await fixture(t),{agent}=await f.pair();const closed=once(agent,"close");
 f.failState(new RDPAuthorizationError(410,"SESSION_ENDED"));
 assert.equal((await closed)[0],1011);
 const end=f.events.find(e=>e.event==="session_finished");
 assert.equal(end.reason,"authorization_failure");assert.equal(end.operation,"state");assert.equal(end.backend_status,410);assert.equal(end.backend_code,"SESSION_ENDED");
 assert.equal(new RDPAuthorizationError(503,"secret raw backend failure").code,"backend_error");
});

test("generic backend exception never logs raw credentials",{timeout:5000},async t=>{
 const f=await fixture(t),{agent}=await f.pair();const closed=once(agent,"close");
 f.failState(Error("ticket=secret Authorization: secret"));await closed;
 const end=f.events.find(e=>e.event==="session_finished");assert.equal(end.backend_code,"backend_unavailable");
 assert.ok(!JSON.stringify(f.events).includes("secret"));
});

test("control queue overflow has a precise failure reason",{timeout:5000},async t=>{
 const f=await fixture(t,{canDrain:()=>false}),{client,agent}=await f.pair();
 const closed=once(agent,"close");for(let i=0;i<257;i++)client.send(Buffer.from([2,123,125]));
 assert.equal((await closed)[0],1011);
 const end=f.events.find(e=>e.event==="session_finished");assert.equal(end.reason,"queue_overflow");assert.equal(end.queue_depth,256);
});

test("downstream callback failure remains an error",{timeout:5000},async t=>{
 let intercepted=false;
 const f=await fixture(t,{canDrain:o=>{
  if(!intercepted){intercepted=true;o.session[o.role].send=(_data,_options,callback)=>callback(Error("private transport detail"));}
  return true;
 }}),{client,agent}=await f.pair();
 const closed=once(agent,"close");client.send(Buffer.from([2,123,125]));assert.equal((await closed)[0],1011);
 assert.equal(f.events.find(e=>e.event==="session_finished").reason,"downstream_send_failure");
});

test("late policy reply cannot rearm a terminated session",{timeout:5000},async t=>{
 const f=await fixture(t),{client,agent}=await f.pair();
 let release;const waiting=once(f.notification,"state_waiting");
 f.gateState(new Promise(resolve=>{release=resolve;}));await waiting;
 const closed=once(agent,"close");client.close(1000);await closed;release();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.events.filter(e=>e.event==="session_finished").length,1);
 assert.equal(f.receipts.length,1);
});

test("active binary traffic survives the one-minute pairing and idle boundaries",{timeout:90000},async t=>{
 if(process.env.SENTINELGRID_RDP_SOAK!=="1") { t.skip("set SENTINELGRID_RDP_SOAK=1 for the 65-second loopback soak");return; }
 const f=await fixture(t,{pairMs:60000,pollMs:5000,lifetimeMs:85000}),{client,agent}=await f.pair();
 let count=0;const started=Date.now();
 while(Date.now()-started<65000) {
  const forwarded=once(client,"message");agent.send(Buffer.from([1,0]));await forwarded;count++;
  await new Promise(resolve=>setTimeout(resolve,1000/30));
 }
 assert.equal(client.readyState,WebSocket.OPEN);assert.equal(agent.readyState,WebSocket.OPEN);
 assert.ok(count>0,"no frames forwarded");assert.equal(f.receipts.length,0);
 const closed=once(agent,"close");client.close(1000);assert.equal((await closed)[0],1000);
 t.diagnostic(`${count} binary frames forwarded over 65 seconds; no arbitrary 60s termination`);
});


test("downstream write has exactly one bounded 15-second deadline",{timeout:5000},async t=>{
 t.mock.timers.enable({apis:["setTimeout","setInterval"]});
 let blocked;
 const reached=new Promise(resolve=>{blocked=resolve;});
 const f=await fixture(t,{lifetimeMs:60000,canDrain:o=>{
  o.session[o.role].send=()=>{};
  blocked();return true;
 }}),{client,agent}=await f.pair();
 const closed=once(agent,"close");client.send(Buffer.from([2,123,125]));await reached;
 t.mock.timers.tick(14999);
 assert.equal(f.receipts.length,0,"send expired before its bounded deadline");
 t.mock.timers.tick(1);
 assert.equal((await closed)[0],1011);
 assert.equal(f.events.find(e=>e.event==="session_finished").reason,"downstream_send_timeout");
 t.mock.timers.tick(120000);
 assert.equal(f.receipts.length,1,"ended session retained active timers");
});

test("downstream buffered-byte limit reports backpressure separately",{timeout:5000},async t=>{
 const f=await fixture(t,{canDrain:o=>{
  Object.defineProperty(o.session[o.role],"bufferedAmount",{value:8*1024*1024+1});return true;
 }}),{client,agent}=await f.pair();
 const closed=once(agent,"close");client.send(Buffer.from([2,123,125]));assert.equal((await closed)[0],1011);
 const end=f.events.find(e=>e.event==="session_finished");
 assert.equal(end.reason,"downstream_backpressure");assert.equal(end.buffered_bytes,8*1024*1024+1);
});
