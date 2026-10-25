import test from 'node:test';import assert from 'node:assert/strict';
import {directoryPolicyConfig} from '../src/nexus/source-discovery/directory-policy-config.ts';
const env={NEXUS_DIRECTORY_STANDING_POLICY_ID:'existing-policy',NEXUS_DIRECTORY_STANDING_POLICY_SHA256:'a'.repeat(64),NEXUS_SHARED_INTELLIGENCE_POLICY_SHA256:'b'.repeat(64)};
test('shared runtime selection preserves the existing default policy and rejects unapproved selectors',()=>{
 assert.deepEqual(directoryPolicyConfig('https://aire.example/api/integrations/nexus/directory-verify',env),{policyId:'existing-policy',approvedPolicyHash:'a'.repeat(64)});
 assert.deepEqual(directoryPolicyConfig('https://aire.example/api/integrations/nexus/directory-verify?policy=shared-intelligence-uk-v1',env),{policyId:'shared-intelligence-uk-v1',approvedPolicyHash:'b'.repeat(64)});
 assert.equal(directoryPolicyConfig('https://aire.example/?policy=other',env),null);
 assert.equal(directoryPolicyConfig('https://aire.example/?policy=shared-intelligence-uk-v1',{...env,NEXUS_SHARED_INTELLIGENCE_POLICY_SHA256:undefined}),null);
 assert.equal(directoryPolicyConfig('https://aire.example/?policy=shared-intelligence-uk-v1&policy=other',env),null);
});
