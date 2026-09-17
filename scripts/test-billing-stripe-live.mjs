import nextEnv from '@next/env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dashboardLoader } from './dashboard-test-loader.mjs';
nextEnv.loadEnvConfig(process.cwd(),true);
if (process.env.SENTINELGRID_RUN_STRIPE_TESTS !== '1') throw new Error('Set SENTINELGRID_RUN_STRIPE_TESTS=1 to create isolated Stripe TEST resources. Never runs against LIVE mode.');
if (!process.env.STRIPE_SECRET_KEY?.includes('_test_')) throw new Error('A Stripe test-mode key is required');
const load=dashboardLoader({'server-only':{}});
const {getStripe,validatePrice}=load('lib/billing/stripe.ts');
const {scheduleSubscriptionDowngrade,upgradeSubscription}=load('lib/billing/subscriptions.ts');
const stripe=getStripe();
const pro=await validatePrice('pro'), business=await validatePrice('business');
let customer,clock;
const subscriptions=[];
const sessions=[];
async function advance(to) {
  await stripe.testHelpers.testClocks.advance(clock.id,{frozen_time:to});
  for(let n=0;n<40;n++) {
    await new Promise(r=>setTimeout(r,1000));
    if((await stripe.testHelpers.testClocks.retrieve(clock.id)).status==='ready') return;
  }
  throw new Error('Stripe test clock did not become ready');
}
try {
  clock=await stripe.testHelpers.testClocks.create({frozen_time:Math.floor(Date.now()/1000),name:'SentinelGrid billing qualification'});
  customer=await stripe.customers.create({name:`SentinelGrid isolated billing test ${randomUUID()}`,test_clock:clock.id,metadata:{purpose:'sentinelgrid-billing-qualification'}});
  const method=await stripe.paymentMethods.attach('pm_card_visa',{customer:customer.id});
  await stripe.customers.update(customer.id,{invoice_settings:{default_payment_method:method.id}});
  for(const price of [pro,business]) {
    const session=await stripe.checkout.sessions.create({customer:customer.id,mode:'subscription',line_items:[{price,quantity:1}],success_url:'https://example.com/success',cancel_url:'https://example.com/cancel'});
    sessions.push(session.id);assert.ok(session.url);await stripe.checkout.sessions.expire(session.id);
  }
  console.log('PASS: Free -> Pro and Free -> Business official Checkout sessions');
  let sub=await stripe.subscriptions.create({customer:customer.id,items:[{price:pro,quantity:1}],payment_behavior:'error_if_incomplete'});
  subscriptions.push(sub.id);assert.equal(sub.status,'active');
  sub=await upgradeSubscription(sub,business);
  assert.equal(sub.items.data[0].price.id,business);assert.equal(sub.status,'active');
  console.log('PASS: production upgrade helper, immediate prorated Business payment');
  const downgrade=await scheduleSubscriptionDowngrade(sub,pro);
  const schedule=await stripe.subscriptionSchedules.retrieve(downgrade.scheduleId);
  assert.equal(schedule.phases[1].items[0].price,pro);
  assert.equal((await stripe.subscriptions.retrieve(sub.id)).items.data[0].price.id,business);
  await advance(sub.items.data[0].current_period_end+60);
  sub=await stripe.subscriptions.retrieve(sub.id);
  assert.equal(sub.items.data[0].price.id,pro);
  await stripe.subscriptionSchedules.release(downgrade.scheduleId);
  console.log('PASS: production schedule helper; Business -> Pro at period end');
  sub=await stripe.subscriptions.update(sub.id,{cancel_at_period_end:true});assert.equal(sub.cancel_at_period_end,true);
  sub=await stripe.subscriptions.update(sub.id,{cancel_at_period_end:false});assert.equal(sub.cancel_at_period_end,false);
  console.log('PASS: cancellation scheduled and resumed');
  await stripe.subscriptions.update(sub.id,{cancel_at_period_end:true});
  await advance(sub.items.data[0].current_period_end+60);
  assert.equal((await stripe.subscriptions.retrieve(sub.id)).status,'canceled');
  console.log('PASS: definitive cancellation at period end (database Free transition tested separately)');
  let recovery=await stripe.subscriptions.create({customer:customer.id,items:[{price:pro,quantity:1}],payment_behavior:'error_if_incomplete'});
  subscriptions.push(recovery.id);
  const declined=await stripe.paymentMethods.attach('pm_card_chargeCustomerFail',{customer:customer.id});
  await stripe.subscriptions.update(recovery.id,{default_payment_method:declined.id});
  await advance(recovery.items.data[0].current_period_end+7200);
  recovery=await stripe.subscriptions.retrieve(recovery.id);
  assert.equal(recovery.status,'past_due');
  const invoiceId=typeof recovery.latest_invoice==='string'?recovery.latest_invoice:recovery.latest_invoice.id;
  await stripe.subscriptions.update(recovery.id,{default_payment_method:method.id});
  await stripe.invoices.pay(invoiceId,{payment_method:method.id});
  assert.equal((await stripe.subscriptions.retrieve(recovery.id)).status,'active');
  console.log('PASS: failed renewal enters past_due; real invoice payment recovers active state');
} catch(error) {
  console.error('Stripe TEST qualification failed:',error.type ?? error.name,error.code ?? '',String(error.message).replace(/(?:sk|rk|whsec)_[A-Za-z0-9_]+/g,'[redacted]'));
  process.exitCode=1;
} finally {
  for(const sessionId of sessions) {
    const session=await stripe.checkout.sessions.retrieve(sessionId);
    if(session.status==='open') await stripe.checkout.sessions.expire(sessionId);
  }
  for(const subscriptionId of subscriptions) {
    const sub=await stripe.subscriptions.retrieve(subscriptionId);
    if(sub.status!=='canceled') await stripe.subscriptions.cancel(subscriptionId);
  }
  if(clock) await stripe.testHelpers.testClocks.del(clock.id);
  else if(customer) await stripe.customers.del(customer.id);
  console.log('Isolated Stripe test resources cleaned up');
}
