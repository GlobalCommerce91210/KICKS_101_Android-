import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerIosAccountCompatibilityRoutes } from './ios-account-compatibility.js';

const account = 'acct-test-1';
const deviceId = 'b5d5148a-12f1-4a10-96e3-fec1d1d89f52';
const requestId = 'd118d981-bb51-46f2-bbb6-23aa74b3f7c1';
const permissionId = '6d420fec-c90c-4a4e-a5c2-1d8d0a4b8220';
const body = { requestId, deviceId, deviceToken: 'a'.repeat(40), publicKey: 'b'.repeat(40) };

function setup(overrides: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const app = Fastify();
  const deps = {
    sessions: { resolve: async (header?: string) => header === 'Bearer valid-account' ? account : null },
    bindings: { list: async (subject: string) => {
      calls.push(['list', subject]);
      return [{ device_id: deviceId, subject_id: subject, status: 'active', platform: 'ios' }];
    } },
    provisioner: { provision: async (input: unknown) => {
      calls.push(['provision', input]);
      return { deviceId, accountSubjectId: account, status: 'provisioned' as const };
    } },
    consent: {
      getHistory: async () => [],
      recordDecision: async (input: unknown) => {
        calls.push(['consent', input]);
        return { id: requestId, ...input as object };
      }
    },
    ...overrides
  };
  registerIosAccountCompatibilityRoutes(app, deps as Parameters<typeof registerIosAccountCompatibilityRoutes>[1]);
  return { app, calls };
}

test('unauthenticated clients cannot enumerate or provision devices', async () => {
  const { app, calls } = setup();
  try {
    const listed = await app.inject({ method: 'GET', url: '/core/consumer/v1/devices' });
    const provisioned = await app.inject({ method: 'POST', url: '/core/consumer/v1/ios/devices/provision', payload: body });
    assert.equal(listed.statusCode, 401);
    assert.equal(provisioned.statusCode, 401);
    assert.deepEqual(calls, []);
  } finally { await app.close(); }
});

test('account subject is resolved server-side and collection stays off', async () => {
  const { app, calls } = setup();
  try {
    const response = await app.inject({ method: 'POST', url: '/core/consumer/v1/ios/devices/provision',
      headers: { authorization: 'Bearer valid-account' }, payload: body });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().monitoringDefaultOn, false);
    assert.equal((calls[0] as [string, { accountSubjectId: string }])[1].accountSubjectId, account);
    const list = await app.inject({ method: 'GET', url: '/core/consumer/v1/devices',
      headers: { authorization: 'Bearer valid-account' } });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().devices[0].subject_id, account);
  } finally { await app.close(); }
});

test('provisioning conflict does not reveal the existing owner', async () => {
  const { app } = setup({ provisioner: { provision: async () => { throw new Error('provisioning_conflict'); } } });
  try {
    const response = await app.inject({ method: 'POST', url: '/core/consumer/v1/ios/devices/provision',
      headers: { authorization: 'Bearer valid-account' }, payload: body });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'device_conflict' });
  } finally { await app.close(); }
});

test('database failures fail closed', async () => {
  const { app } = setup({ provisioner: { provision: async () => { throw new Error('database offline'); } } });
  try {
    const response = await app.inject({ method: 'POST', url: '/core/consumer/v1/ios/devices/provision',
      headers: { authorization: 'Bearer valid-account' }, payload: body });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'provisioning_unavailable');
  } finally { await app.close(); }
});

test('durable consent receives authenticated subject, not client-supplied identity', async () => {
  const { app, calls } = setup();
  try {
    const response = await app.inject({ method: 'POST', url: '/core/consumer/v1/consent',
      headers: { authorization: 'Bearer valid-account' },
      payload: { permissionId, requestId, action: 'revoke', policyVersion: '1', purposeVersion: '1', purpose: 'metadata' } });
    assert.equal(response.statusCode, 201);
    assert.equal((calls[0] as [string, { subjectId: string }])[1].subjectId, account);
  } finally { await app.close(); }
});
