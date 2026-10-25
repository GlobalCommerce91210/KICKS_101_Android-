import test from 'node:test';
import assert from 'node:assert/strict';
import { IdentityEngine, MemoryIdentityRepository } from './identity.js';
import { memoryStore } from './server.js';

const PASSWORD = 'Beta-Only-Strong-Password-2026!';

test('registration is idempotent for an existing DataStorm account', () => {
  const repo = new MemoryIdentityRepository();
  const first = new IdentityEngine(repo).register('Beta@Example.com', PASSWORD);
  const afterRestart = new IdentityEngine(repo).register('beta@example.com', PASSWORD);
  assert.equal(first.created, true);
  assert.equal(afterRestart.created, false);
  assert.equal(afterRestart.account.subjectId, first.account.subjectId);
});

test('email verification succeeds once and rejects replay', () => {
  const engine = new IdentityEngine();
  const { account } = engine.register('verify@example.com', PASSWORD);
  const token = engine.issueToken(account.subjectId, 'email_verification', 60_000);
  assert.equal(engine.verifyEmail(token)?.status, 'active');
  assert.equal(engine.verifyEmail(token), null);
});

test('expired and revoked tokens fail', async () => {
  const repo = new MemoryIdentityRepository();
  const engine = new IdentityEngine(repo);
  const { account } = engine.register('expiry@example.com', PASSWORD);
  const expired = engine.issueToken(account.subjectId, 'email_verification', -1);
  assert.equal(engine.verifyEmail(expired), null);
  const refresh = engine.issueToken(account.subjectId, 'refresh', 60_000);
  repo.revokeTokens(account.subjectId, 'refresh');
  assert.equal(engine.consumeToken(refresh, 'refresh'), null);
});

test('suspended and closed accounts cannot authenticate or create sessions', () => {
  const engine = new IdentityEngine();
  const { account } = engine.register('status@example.com', PASSWORD);
  const verify = engine.issueToken(account.subjectId, 'email_verification', 60_000);
  engine.verifyEmail(verify);
  assert.ok(engine.authenticate(account.email, PASSWORD));
  engine.setStatus(account.subjectId, 'suspended');
  assert.equal(engine.authenticate(account.email, PASSWORD), null);
  assert.equal(engine.canCreateSession(account.subjectId), false);
  engine.setStatus(account.subjectId, 'closed');
  assert.equal(engine.canCreateSession(account.subjectId), false);
});

test('identity creation has zero implicit collector monitoring or consent', () => {
  const collector = memoryStore();
  const before = { devices: collector.devices.size, consents: collector.consents.size, batches: collector.batches.size, observations: collector.observations.length };
  const engine = new IdentityEngine();
  engine.register('zero-consent@example.com', PASSWORD);
  assert.deepEqual({ devices: collector.devices.size, consents: collector.consents.size, batches: collector.batches.size, observations: collector.observations.length }, before);
});
