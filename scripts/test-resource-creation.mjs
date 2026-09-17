import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardLoader } from './dashboard-test-loader.mjs';
const plans=dashboardLoader()('lib/plans.ts');
const access=dashboardLoader()('lib/organization-access-core.ts');
for (const resource of plans.RESOURCES) {
  test(`${resource} creation obeys exact plan quotas after downgrade`,()=>{
    for (const plan of ['free','pro','business']) {
      const limit=plans.PLANS[plan].limits[resource];
      for(const status of ['active','past_due','canceled']) {
        assert.equal(plans.canCreateResource({plan,resource,currentUsage:limit-1,subscriptionStatus:status}),true);
        assert.equal(plans.canCreateResource({plan,resource,currentUsage:limit,subscriptionStatus:status}),false);
        assert.equal(plans.canCreateResource({plan,resource,currentUsage:limit+100,subscriptionStatus:status}),false);
      }
    }
  });
}
test('members cannot create resources and Enterprise capacity must be explicitly licensed',()=>{
  for (const permission of ['clients.create','devices.create','monitors.create']) assert.equal(access.roleHasPermission('member',permission),false);
  assert.equal(plans.canCreateResource({plan:'enterprise',resource:'devices',currentUsage:249,customLimits:{devices:250}}),true);
  assert.equal(plans.canCreateResource({plan:'enterprise',resource:'devices',currentUsage:250,customLimits:{devices:250}}),false);
  assert.throws(()=>plans.getPlanLimit('enterprise','devices',{devices:null}),/not configured/);
});
