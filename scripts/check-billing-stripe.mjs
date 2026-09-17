import nextEnv from '@next/env';
import Stripe from 'stripe';
import { dashboardLoader } from './dashboard-test-loader.mjs';
nextEnv.loadEnvConfig(process.cwd(), true);
const {PLANS}=dashboardLoader()('lib/plans.ts');
if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is missing');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 1 });
try {
  for (const plan of ['pro','business']) {
    const prefix=plan.toUpperCase();
    const priceId=process.env[`STRIPE_${prefix}_PRICE_ID`];
    const productId=process.env[`STRIPE_${prefix}_PRODUCT_ID`];
    if (!priceId || !productId) throw new Error(`${prefix} Stripe configuration missing`);
    const price=await stripe.prices.retrieve(priceId);
    if (price.product !== productId || !price.active || price.currency !== 'eur' || price.unit_amount !== PLANS[plan].monthlyPriceCents || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1) throw new Error(`${prefix} Stripe price configuration mismatch`);
    console.log(`${prefix}: official monthly EUR price verified; mode=${price.livemode?'LIVE':'TEST'}`);
  }
} catch (error) {
  console.error('Stripe configuration check failed:', error.type ?? error.name, error.code ?? 'configuration mismatch');
  process.exitCode=1;
}
