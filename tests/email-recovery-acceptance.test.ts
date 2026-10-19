import test from 'node:test';
import assert from 'node:assert/strict';
import { handleEmailRecoveryAcceptance } from '../src/nexus/email-recovery-acceptance.ts';

test('synthetic acceptance is absent in production even when explicitly enabled', async () => {
  const response = await handleEmailRecoveryAcceptance(new Request('https://example.org', { method: 'POST' }), { VERCEL_ENV: 'production', EMAIL_RECOVERY_ACCEPTANCE_ENABLED: 'true', EMAIL_RECOVERY_ACCEPTANCE_SECRET: 'fixture-only' });
  assert.equal(response.status, 404);
});
test('synthetic acceptance still requires the normal signed Nexus envelope', async () => {
  const response = await handleEmailRecoveryAcceptance(new Request('https://example.org', { method: 'POST', body: '{}' }), { VERCEL_ENV: 'preview', EMAIL_RECOVERY_ACCEPTANCE_ENABLED: 'true', EMAIL_RECOVERY_ACCEPTANCE_SECRET: 'fixture-only' });
  assert.equal(response.status, 401);
});
