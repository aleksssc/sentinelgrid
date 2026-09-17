import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { dashboardLoader } from './dashboard-test-loader.mjs';
const load=dashboardLoader();
const plans=load('lib/plans.ts');
const access=load('lib/organization-access-core.ts');

test('official pricing, limits, role separation and Enterprise licenses',()=>{
 assert.equal(plans.formatPlanPrice('pro'),'\u20ac49.99');
 assert.equal(plans.formatPlanPrice('business'),'\u20ac179.99');
 for(const role of ['owner','admin','member']) {
   assert.equal(access.roleHasPermission(role,'billing.manage'),role==='owner');
   assert.equal(access.roleHasPermission(role,'members.manage'),role==='owner');
   for(const permission of ['clients.create','clients.manage','devices.create','devices.manage','devices.actions','devices.terminal','devices.rdp','monitors.create','monitors.manage']) assert.equal(access.roleHasPermission(role,permission),role!=='member');
 }
 for(const plan of plans.PLAN_ORDER) {
   for(const feature of Object.keys(plans.PLAN_FEATURES[plan])) assert.equal(plans.planHasFeature(plan,feature),true);
   for(const resource of plans.RESOURCES) {
     const customLimits={members:7,clients:8,devices:9,monitors:10};
     const limit=plans.getPlanLimit(plan,resource,customLimits);
     assert.equal(plans.canCreateResource({plan,resource,currentUsage:limit-1,customLimits}),true);
     assert.equal(plans.canCreateResource({plan,resource,currentUsage:limit,customLimits}),false);
     assert.equal(plans.canCreateResource({plan,resource,currentUsage:limit+100,customLimits}),false);
   }
 }
 assert.throws(()=>plans.getPlanLimit('enterprise','devices'),/not configured/);
 assert.throws(()=>plans.getPlanLimit('enterprise','devices',{devices:Infinity}),/not configured/);
 assert.throws(()=>plans.normalizeSubscriptionStatus('invalid'),/Invalid/);
 for(const status of ['active','past_due','canceled']) assert.equal(plans.canCreateResource({plan:'free',resource:'devices',currentUsage:1,subscriptionStatus:status}),true);
 const billing=readFileSync(new URL('../app/dashboard/billing/page.tsx',import.meta.url),'utf8');
 const pricing=readFileSync(new URL('../app/(web)/pricing/page.tsx',import.meta.url),'utf8');
 assert.match(billing,/formatPlanPrice\(plan\)/); assert.match(pricing,/formatPlanPrice\(slug\)/);
});

test('official Stripe SDK verifies raw payload, rejects tampering and expired signatures',()=>{
 const stripe=new Stripe(randomBytes(24).toString('hex'));
 const secret=randomBytes(32).toString('hex');
 const payload=JSON.stringify({id:'evt_signature_test',object:'event',type:'invoice.paid',data:{object:{id:'in_signature_test'}}});
 const header=stripe.webhooks.generateTestHeaderString({payload,secret});
 assert.equal(stripe.webhooks.constructEvent(payload,header,secret).id,'evt_signature_test');
 assert.throws(()=>stripe.webhooks.constructEvent(payload+' ',header,secret));
 assert.throws(()=>stripe.webhooks.constructEvent(payload,header,randomBytes(32).toString('hex')));
 const expired=stripe.webhooks.generateTestHeaderString({payload,secret,timestamp:Math.floor(Date.now()/1000)-600});
 assert.throws(()=>stripe.webhooks.constructEvent(payload,expired,secret));
});
