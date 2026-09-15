import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const MAX_FRAME=2*1024*1024, FRAME=1, H264=7, KEYFRAME=8, MAX_H264_QUEUE=32;
function port(v){const n=Number(v??8443);if(!Number.isInteger(n)||n<1||n>65535)throw Error("Invalid relay port");return n}
export function rdpRelayConfiguration(env=process.env){const backend=new URL(env.SENTINELGRID_RDP_BACKEND_URL??"");if(backend.protocol!=="https:"||backend.username||backend.password||backend.search||backend.hash||backend.pathname!=="/")throw Error("SENTINELGRID_RDP_BACKEND_URL must be an HTTPS origin");const secret=env.SENTINELGRID_RDP_RELAY_SECRET??"";if(!/^[a-f0-9]{64}$/i.test(secret))throw Error("A 32-byte hex relay secret is required");const cert=env.SENTINELGRID_RELAY_TLS_CERT,key=env.SENTINELGRID_RELAY_TLS_KEY;if(!!cert!==!!key)throw Error("Both relay TLS certificate and key are required");const proxy=env.SENTINELGRID_RDP_TRUST_PROXY;if(proxy!==undefined&&proxy!=="true"&&proxy!=="false")throw Error("Invalid RDP TLS proxy setting");const trustProxy=proxy==="true",host=env.SENTINELGRID_RELAY_BIND??"127.0.0.1";if(!cert&&host!=="127.0.0.1"&&host!=="::1"&&!trustProxy)throw Error("Cleartext relay must bind loopback or explicitly trust a private TLS proxy");return{backend,secret,cert,host,key,port:port(env.SENTINGRID_RELAY_PORT??env.SENTINELGRID_RELAY_PORT??env.PORT),trustProxy}}
function isFrame(d){return d.length>0&&d[0]===FRAME} function isH264(d){return d.length>=29&&d[0]===H264&&d.subarray(1,5).toString()==="SGH1"} function isKeyframe(d){return isH264(d)&&(d.readUInt32BE(21)&1)!==0} function frameAge(d){if(!isFrame(d)||d.length<21||d.subarray(1,5).toString()!=="SGF1")return null;const sent=Number(d.readBigUInt64BE(13));return sent>0?Math.max(0,Date.now()*1000-sent)/1000:null}
const backendCodes = new Set(["SESSION_ENDED", "RDP_DISABLED", "DEVICE_OFFLINE", "RDP_UNSUPPORTED", "FORBIDDEN", "UNAUTHORIZED", "INVALID_SESSION_STATE", "RDP_SERVICE_FAILED"]);
export class RDPAuthorizationError extends Error {
 constructor(status, code) {
  super("RDP authorization failed");
  this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  this.code = backendCodes.has(code) ? code : "backend_error";
 }
}
function authorizationDiagnostic(error) {
 return error instanceof RDPAuthorizationError ? { backend_status: error.status, backend_code: error.code } : { backend_code: error?.name === "TimeoutError" ? "backend_timeout" : "backend_unavailable" };
}
export function createRDPRelay({authorize,tls,trustProxy=false,maxSessions=64,pollMs=5000,pairMs=60000,maxH264Queue=MAX_H264_QUEUE,canDrain=()=>true,diagnostic=entry=>console.info("[RDP relay]",JSON.stringify(entry))}){const sessions=new Map();let pending=0;const health=(q,r)=>{r.writeHead(q.url==="/healthz"?200:404,{"Cache-Control":"no-store"});r.end(q.url==="/healthz"?"ok":"not found")};const server=tls?createHTTPSServer(tls,health):createHTTPServer(health);server.headersTimeout=10000;server.requestTimeout=10000;const wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME,perMessageDeflate:false});
function finish(s,failed,reason,details={}) {
 if(s.ended)return;
 s.ended=true;
 clearTimeout(s.pairTimer);clearTimeout(s.expiryTimer);clearTimeout(s.idleTimer);clearInterval(s.pollTimer);clearInterval(s.statsTimer);
 for(const o of [s.clientOutput,s.agentOutput]) if(o) { o.frame=null;o.h264=[];o.controls=[]; }
 sessions.delete(s.id);
 diagnostic({event:"session_finished",session_id:s.id,reason,failed,close_code:failed?1011:1000,phase:s.active?"active":"pairing",age_ms:Date.now()-s.createdAt,idle_ms:Date.now()-s.lastActivity,...details});
 for(const ws of [s.client,s.agent]) if(ws) {
  ws.close(failed?1011:1000,"Session ended");
  if(ws.readyState!==WebSocket.CLOSED) {
   const timer=setTimeout(()=>ws.terminate(),1000);timer.unref();
   ws.once("close",()=>clearTimeout(timer));
  }
 }
 void authorize({operation:"finish",sessionId:s.id,failed}).catch(error=>diagnostic({event:"finish_receipt_failed",session_id:s.id,...authorizationDiagnostic(error)}));
}
function arm(s) { clearTimeout(s.idleTimer);if(s.ended)return;s.idleTimer=setTimeout(()=>finish(s,false,"idle_timeout"),Math.max(0,s.lastActivity+s.idleSeconds*1000-Date.now())); }
function output(s,role){return{session:s,role,sending:false,frame:null,h264:[],recover:false,controls:[],dropped:0,forwarded:0,totalAge:0,maxAge:0}}

function next(o){const d=o.controls.shift()??o.h264.shift()??o.frame;if(d===o.frame)o.frame=null;return d}
function send(s,ws,data,binary,role,done=()=>{}) {
 const timer=setTimeout(()=>finish(s,true,"downstream_send_timeout",{role}),15000);timer.unref();
 const cancel=()=>clearTimeout(timer);
 ws.once("close",cancel);
 ws.send(data,{binary},error=>{
  clearTimeout(timer);ws.off("close",cancel);
  if(s.ended)return;
  if(error)finish(s,true,"downstream_send_failure",{role});else done();
 });
}
function drain(o) {
 if(o.sending||o.session.ended||!canDrain(o))return;
 const data=next(o);if(!data)return;
 const target=o.session[o.role];
 if(!target||target.readyState!==WebSocket.OPEN){finish(o.session,true,"downstream_unavailable",{role:o.role});return}
 if(target.bufferedAmount>8*1024*1024){finish(o.session,true,"downstream_backpressure",{role:o.role,buffered_bytes:target.bufferedAmount});return}
 o.sending=true;
 send(o.session,target,data,true,o.role,()=>{o.sending=false;o.forwarded++;const age=frameAge(data);if(age!==null){o.totalAge+=age;o.maxAge=Math.max(o.maxAge,age)}drain(o)});
}

function requestRecovery(s){const o=s.agentOutput;if(!o||s.ended)return;o.controls.push(Buffer.from([KEYFRAME,...Buffer.from('{"reason":"relay_backpressure"}')])) ;drain(o)}function forward(s,from,data){const o=from==="agent"?s.clientOutput:s.agentOutput;if(from==="agent"&&isFrame(data)){if(o.frame)o.dropped++;o.frame=data}else if(from==="agent"&&isH264(data)){if(o.recover&&!isKeyframe(data)){o.dropped++;return}if(o.h264.length>=maxH264Queue){o.dropped+=o.h264.length;o.h264=[];o.recover=true;requestRecovery(s);if(!isKeyframe(data))return}if(isKeyframe(data))o.recover=false;o.h264.push(data)}else{if(o.controls.length>=256){finish(s,true,"queue_overflow",{role:o.role,queue_depth:o.controls.length});return}o.controls.push(data)}if(data.length){s.lastActivity=Date.now();arm(s)}drain(o)}
async function attach(ws,id) {
 let s=sessions.get(id.sessionId);
 if(!s) {
  s={id:id.sessionId,active:false,ended:false,polling:false,idleSeconds:id.idleSeconds,createdAt:Date.now(),lastActivity:Date.now()};sessions.set(s.id,s);
  s.pairTimer=setTimeout(()=>finish(s,true,"pair_timeout"),pairMs);
  s.expiryTimer=setTimeout(()=>finish(s,false,"session_expired"),Date.parse(id.expiresAt)-Date.now());
  arm(s);
  s.pollTimer=setInterval(async()=>{
   if(s.polling||s.ended)return;s.polling=true;
   try {
    const state=await authorize({operation:"state",sessionId:s.id});
    if(s.ended)return;
    if(!Number.isInteger(state.idleSeconds)||state.idleSeconds<60||state.idleSeconds>7200){finish(s,true,"invalid_policy");return}
    s.idleSeconds=state.idleSeconds;arm(s);
   } catch(error) { finish(s,true,"authorization_failure",{operation:"state",...authorizationDiagnostic(error)}); }
   finally{s.polling=false}
  },pollMs);
 }
 if(s[id.role]){ws.terminate();return}
 s[id.role]=ws;
 ws.on("error",()=>finish(s,true,"peer_socket_error",{role:id.role}));
 ws.on("close",code=>finish(s,![1000,1001,1005].includes(code),[1000,1001,1005].includes(code)?"peer_normal_close":"peer_abnormal_close",{role:id.role,peer_close_code:code}));
 ws.on("message",(data,binary)=>{
  if(!s.active||!binary||data.length>MAX_FRAME){finish(s,true,"protocol_violation",{role:id.role,violation:!s.active?"before_pairing":!binary?"text_payload":"payload_size"});return}
  forward(s,id.role,data);
 });
 if(s.client&&s.agent)try {
  await authorize({operation:"active",sessionId:s.id});if(s.ended)return;
  clearTimeout(s.pairTimer);s.active=true;s.clientOutput=output(s,"client");s.agentOutput=output(s,"agent");
  s.statsTimer=setInterval(()=>{const o=s.clientOutput;console.log(`[RDP relay] frames_forwarded=${o.forwarded} frames_dropped=${o.dropped} h264_buffered=${o.h264.length}`)},5000);s.statsTimer.unref();
  diagnostic({event:"session_active",session_id:s.id,idle_seconds:s.idleSeconds,session_expires_at:id.expiresAt});
  for(const role of ["client","agent"])send(s,s[role],'{"type":"ready"}',false,role);
 }catch(error){finish(s,true,"authorization_failure",{operation:"active",...authorizationDiagnostic(error)})}
}

server.on("upgrade",async(q,socket,head)=>{socket.on("error",()=>socket.destroy());if((!tls&&trustProxy&&q.headers["x-forwarded-proto"]!=="https")||q.url!=="/rdp"||q.headers.origin||pending>=32){socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");return}const ticket=/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(q.headers.authorization??"")?.[1];if(!ticket){socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");return}pending++;socket.setTimeout(10000,()=>socket.destroy());try{const id=await authorize({operation:"redeem",ticket});if(!id||!/^[a-f0-9-]{36}$/i.test(id.sessionId)||!["client","agent"].includes(id.role)||!Number.isInteger(id.idleSeconds)||id.idleSeconds<60||id.idleSeconds>7200||!Number.isFinite(Date.parse(id.expiresAt))||Date.parse(id.expiresAt)<=Date.now()||Date.parse(id.expiresAt)>Date.now()+120*60000||socket.destroyed)throw Error("DENIED");if(!sessions.has(id.sessionId)&&sessions.size>=maxSessions)throw Error("CAPACITY");socket.setTimeout(0);wss.handleUpgrade(q,socket,head,ws=>void attach(ws,id))}catch{socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")}finally{pending--}});return{server,async close(){for(const s of sessions.values())finish(s,false,"relay_shutdown");wss.close();await new Promise((r,j)=>server.close(e=>e?j(e):r()))}}}
async function main(){const c=rdpRelayConfiguration();const relay=createRDPRelay({tls:c.cert?{cert:readFileSync(c.cert),key:readFileSync(c.key),minVersion:"TLSv1.2"}:undefined,trustProxy:c.trustProxy,authorize:async body=>{const response=await fetch(new URL("/api/remote/rdp/relay",c.backend),{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${c.secret}`,"Content-Type":"application/json"},body:JSON.stringify(body)});if(!response.ok){let code;try{code=(await response.json()).error}catch{code="backend_error"}throw new RDPAuthorizationError(response.status,code)}return response.json()}});await new Promise((r,j)=>{relay.server.once("error",j);relay.server.listen(c.port,c.host,r)});console.log("RDP relay listening; one instance per configured relay URL",c.host,c.port);for(const signal of["SIGINT","SIGTERM"])process.once(signal,()=>void relay.close().catch(()=>process.exitCode=1))}if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error("RDP relay startup failed: check TLS, backend origin, relay secret and bind configuration");process.exitCode=1})
