import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
mkdirSync(resolve("dist", "qualification"), { recursive: true });
const log = createWriteStream(resolve("dist", "qualification", "web-smoke.log"));
const child = spawn(process.execPath, [resolve("node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
 stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const exited = once(child, "exit");
const origin = `http://127.0.0.1:${port}`;
async function request(path, options = {}) {
 return fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(3000), ...options });
}
try {
 let ready = false;
 for (let attempt = 0; attempt < 40; attempt++) {
  if (child.exitCode !== null) throw new Error("Local Next server exited; see web-smoke.log");
  try { await request("/api/remote/rdp/relay", { method: "POST" }); ready = true; break; }
  catch { await delay(250); }
 }
 assert.ok(ready, "Local Next server did not become responsive");
 const device = "40000000-0000-4000-8000-000000000001";
 const cases = [
  ["/api/remote/rdp/relay", { method: "POST" }, 401],
  ["/api/agent/rdp", { method: "POST" }, 401],
  [`/api/devices/${device}/rdp`, {}, 401],
  [`/api/devices/${device}/rdp`, { method: "POST", headers: { Origin: "https://untrusted.example" }, body: "{}" }, 403],
  [`/api/devices/${device}/rdp`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: '{"reason":"HTTP security test"}' }, 401],
 ];
 for (const [path, options, expected] of cases) {
  const response = await request(path, options);
  assert.equal(response.status, expected, path);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  console.log(`PASS ${options.method ?? "GET"} ${path}: ${expected}, JSON, no redirect`);
 }
} finally {
 if (child.exitCode === null) child.kill();
 await exited;
 log.end();
}
