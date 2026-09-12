import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { WebSocket } from "ws";
import { createRealtimeRelay } from "../relay/realtime-relay.mjs";

const require = createRequire(import.meta.url);
function load(file, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => overrides[name] ?? require(name), exports);
  return exports;
}
const endpoint = load("../lib/realtime/endpoint.ts");

test("endpoint discovery accepts only explicit WSS origins", async t => {
  for (const origin of ["http://relay.example", "ws://relay.example", "wss://user:password@relay.example", "wss://relay.example/path", "wss://relay.example?token=x", "wss://relay.example#", "wss://relay.example?"]) {
    assert.throws(() => endpoint.realtimeOrigin(origin));
  }
  assert.equal(endpoint.realtimeOrigin(undefined), null);
  assert.equal(endpoint.realtimeOrigin("wss://relay.example/"), "wss://relay.example");
  t.mock.method(globalThis, "fetch", async () => Response.json({ origin: "wss://relay.example" }));
  assert.equal(await endpoint.browserRealtimeURL("https://app.example", new AbortController().signal), "wss://relay.example/api/realtime/browser");
  globalThis.fetch = async () => Response.json({ origin: null });
  assert.equal(await endpoint.browserRealtimeURL("https://app.example", new AbortController().signal), "wss://app.example/api/realtime/browser");
  for (const body of [{}, {origin:""}, {origin:42}]) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(endpoint.browserRealtimeURL("https://app.example", new AbortController().signal));
  }
  globalThis.fetch = async () => new Response(null, {status:503});
  await assert.rejects(endpoint.browserRealtimeURL("https://app.example", new AbortController().signal));
});

test("endpoint route fails explicitly on bad configuration and never caches discovery", async () => {
  const previous = process.env.SENTINELGRID_REALTIME_URL;
  try {
    const route = load("../app/api/realtime/endpoint/route.ts", {"@/lib/realtime/endpoint": endpoint, "next/server": {connection: async () => {}}});
    process.env.SENTINELGRID_REALTIME_URL = "ws://insecure.example";
    assert.equal((await route.GET()).status, 503);
    delete process.env.SENTINELGRID_REALTIME_URL;
    assert.equal((await route.GET()).headers.get("Cache-Control"), "no-store");
  } finally {
    if (previous === undefined) delete process.env.SENTINELGRID_REALTIME_URL;
    else process.env.SENTINELGRID_REALTIME_URL = previous;
  }
});

async function fixture(t, options = {}) {
  const relay = createRealtimeRelay({allowedOrigin:"https://app.example", agent:ws => ws.on("message", data => ws.send(data.toString())), browser:ws => ws.on("message", data => ws.send(data.toString())), ...options});
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server,"listening");
  t.after(() => relay.close());
  return { ...relay, url:`ws://127.0.0.1:${relay.server.address().port}` };
}

test("standalone relay serves health, preserves messages and enforces browser/agent boundaries", {timeout:5000}, async t => {
  const f = await fixture(t);
  assert.equal(await (await fetch(f.url.replace("ws:","http:")+"/healthz")).text(), "ok");
  for (const [path, headers] of [["/api/realtime/agent",{}], ["/api/realtime/browser",{Origin:"https://app.example"}]]) {
    const ws = new WebSocket(f.url+path,{headers});
    await once(ws,"open");
    const received = once(ws,"message");
    ws.send(JSON.stringify({type:"ping"}));
    assert.deepEqual(JSON.parse((await received)[0].toString()),{type:"ping"});
    const closed = once(ws,"close"); ws.close(); await closed;
  }
  for (const [path, headers] of [["/unknown",{}], ["/api/realtime/agent?token=x",{}], ["/api/realtime/agent",{Origin:"https://app.example"}], ["/api/realtime/browser",{}], ["/api/realtime/browser",{Origin:"https://evil.example"}]]) {
    const ws = new WebSocket(f.url+path,{headers});
    await once(ws,"error");
  }
});

test("relay caps connections, kills unresponsive peers and shuts down cleanly", {timeout:5000}, async t => {
  const f = await fixture(t,{maxConnections:1,heartbeatMs:30});
  const ws = new WebSocket(f.url+"/api/realtime/agent",{autoPong:false});
  const closed = once(ws,"close");
  await once(ws,"open");
  const excess = new WebSocket(f.url+"/api/realtime/agent");
  await once(excess,"error");
  await closed;
  await f.close();
});

test("Redis stream EOF and oversized frames fail instead of leaving zombie sockets", async t => {
  const oldURL=process.env.UPSTASH_REDIS_KV_REST_API_URL, oldToken=process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  process.env.UPSTASH_REDIS_KV_REST_API_URL="https://redis.example";
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN="synthetic-test-token";
  t.after(() => {
    if(oldURL===undefined) delete process.env.UPSTASH_REDIS_KV_REST_API_URL; else process.env.UPSTASH_REDIS_KV_REST_API_URL=oldURL;
    if(oldToken===undefined) delete process.env.UPSTASH_REDIS_KV_REST_API_TOKEN; else process.env.UPSTASH_REDIS_KV_REST_API_TOKEN=oldToken;
  });
  const pubsub = load("../lib/realtime/pubsub.ts",{"./redis":{getRedis:()=>{throw Error("unexpected Redis call");}}});
  const received=[];
  t.mock.method(globalThis,"fetch",async () => new Response('data: message,test,{"type":"ping"}\n\n'));
  await assert.rejects(pubsub.subscribeRealtimeChannel("test",message=>received.push(message)).done,/ended unexpectedly/);
  assert.deepEqual(received,[{type:"ping"}]);
  globalThis.fetch=async () => new Response("x".repeat(4*1024*1024+1));
  await assert.rejects(pubsub.subscribeRealtimeChannel("test",()=>{}).done,/too large/);
  globalThis.fetch=async () => new Response('data: message,test,not-json\n\n');
  await assert.rejects(pubsub.subscribeRealtimeChannel("test",()=>{}).done,/invalid JSON/);
  let cleanupErrors = 0;
  t.mock.method(console, "error", () => { cleanupErrors++; });
  let receivedMessage;
  const delivered = new Promise(resolve => { receivedMessage = resolve; });
  globalThis.fetch = async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      controller.enqueue(new TextEncoder().encode('data: message,test,{"type":"ping"}\n\n'));
    },
  }));
  const subscription = pubsub.subscribeRealtimeChannel("test", () => receivedMessage());
  await delivered;
  subscription.abort();
  await subscription.done;
  assert.equal(cleanupErrors, 0, "normal abort must not be logged as a cleanup failure");
});
