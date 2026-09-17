import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import Stripe from 'stripe';
nextEnv.loadEnvConfig(process.cwd(),true);
const port=3047;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{stdio:'ignore'});
const base=`http://localhost:${port}`;
try {
  let responsive=false;
  for(let n=0;n<40;n++) {
    if(server.exitCode!==null) throw new Error('Isolated Next.js server exited');
    try {const response=await fetch(`${base}/api/stripe/webhook`,{method:'POST',redirect:'manual'}); if(response.status===400){responsive=true;break;}}catch(error){if(error.name!=='TypeError')throw error;}
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(responsive,'Webhook must be accessible without Supabase browser authentication');
  const unsigned=await fetch(`${base}/api/stripe/webhook`,{method:'POST',body:'{}',redirect:'manual'});assert.equal(unsigned.status,400);
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
  const payload=JSON.stringify({id:'evt_http_signature_qualification',object:'event',type:'sentinelgrid.signature.qualification',data:{object:{}}});
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret:process.env.STRIPE_WEBHOOK_SECRET});
  const signed=await fetch(`${base}/api/stripe/webhook`,{method:'POST',headers:{'stripe-signature':signature},body:payload,redirect:'manual'});
  assert.equal(signed.status,200);assert.equal((await signed.json()).received,true);
  const altered=await fetch(`${base}/api/stripe/webhook`,{method:'POST',headers:{'stripe-signature':signature},body:payload+' ',redirect:'manual'});assert.equal(altered.status,400);
  const forbidden=await fetch(`${base}/api/billing/checkout`,{method:'POST',body:'{}',redirect:'manual'});assert.equal(forbidden.status,403);
  const headers={'Content-Type':'application/json',Origin:new URL(process.env.NEXT_PUBLIC_SITE_URL).origin};
  const arbitrary=await fetch(base+'/api/billing/checkout',{method:'POST',headers,body:JSON.stringify({organizationId:'10000000-0000-4000-8000-000000000011',plan:'pro',price_id:'price_arbitrary'}),redirect:'manual'});
  assert.equal(arbitrary.status,400);
  const unauthenticated=await fetch(base+'/api/billing/checkout',{method:'POST',headers,body:JSON.stringify({organizationId:'10000000-0000-4000-8000-000000000011',plan:'pro'}),redirect:'manual'});
  assert.equal(unauthenticated.status,403);
  console.log('PASS: real Next.js webhook routing, raw signature verification, tampering rejection and billing Origin protection');
} finally {server.kill();}
