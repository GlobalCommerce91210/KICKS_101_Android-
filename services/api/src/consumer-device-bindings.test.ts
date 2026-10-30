import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryConsumerDeviceBindingStore, PostgresConsumerDeviceBindingStore, DeviceOwnershipConflict, DeviceBindingRevoked, DeviceBindingAmbiguous, type ConsumerDeviceBinding } from './consumer-device-bindings.js';
import type { Pool } from 'pg';

test('unlink preserves ownership and cannot silently reactivate or change collector identity', async () => {
  const store = new MemoryConsumerDeviceBindingStore();
  const input = { subjectId: 'owner', deviceId: 'tablet', collectorSubjectId: 'collector', platform: 'ios' as const };
  await store.bind(input);
  await assert.rejects(store.bind({ ...input, collectorSubjectId: 'replacement' }), DeviceOwnershipConflict);
  await assert.rejects(store.bind({ ...input, platform: 'android' }), DeviceOwnershipConflict);
  assert.equal(await store.revoke('owner', 'tablet'), true);
  await assert.rejects(store.bind(input), DeviceBindingRevoked);
  await assert.rejects(store.bind({ ...input, subjectId: 'another-owner' }), DeviceOwnershipConflict);
});

test('a device has one active owner, retries preserve identity, and another account cannot revoke it', async () => {
  const store = new MemoryConsumerDeviceBindingStore();
  const input = { subjectId: 'first', deviceId: 'tablet', collectorSubjectId: 'collector', platform: 'ios' as const };
  const first = await store.bind(input);
  assert.deepEqual(await store.bind(input), first);
  await assert.rejects(store.bind({ ...input, subjectId: 'second' }), DeviceOwnershipConflict);
  assert.equal(await store.revoke('second', 'tablet'), false);
  assert.equal((await store.list('first')).length, 1);
  assert.equal((await store.list('second')).length, 0);
});

test('competing accounts cannot both claim an unowned device', async () => {
  const store = new MemoryConsumerDeviceBindingStore();
  const results = await Promise.allSettled(['first', 'second'].map(subjectId => store.bind({
    subjectId, deviceId: 'tablet', collectorSubjectId: 'collector',
  })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});

test('reverse lookup preserves distinct identities, returns a copy, and does not bind an unknown device', async () => {
  const store = new MemoryConsumerDeviceBindingStore();
  assert.equal(await store.findActiveByDeviceId('absent'), null);
  const binding = await store.bind({ subjectId: 'account', deviceId: 'device', collectorSubjectId: 'collector' });
  const found = await store.findActiveByDeviceId('device');
  assert.deepEqual(found, binding);
  assert.notEqual(found?.subject_id, found?.collector_subject_id);
  found!.subject_id = 'changed-copy';
  assert.equal((await store.findActiveByDeviceId('device'))?.subject_id, 'account');
  assert.equal((await store.list('changed-copy')).length, 0);
});

test('reverse lookup rejects revoked bindings', async () => {
  const store = new MemoryConsumerDeviceBindingStore();
  await store.bind({ subjectId: 'account', deviceId: 'device', collectorSubjectId: 'collector' });
  await store.revoke('account', 'device');
  await assert.rejects(store.findActiveByDeviceId('device'), DeviceBindingRevoked);
});

test('reverse lookup rejects ambiguous ownership instead of choosing a row', async () => {
  const store = new MemoryConsumerDeviceBindingStore();
  const first = await store.bind({ subjectId: 'account', deviceId: 'device', collectorSubjectId: 'collector' });
  const rows = (store as unknown as { bindings: Map<string, ConsumerDeviceBinding> }).bindings;
  rows.set('other:device', { ...first, subject_id: 'other', binding_id: 'other-binding' });
  await assert.rejects(store.findActiveByDeviceId('device'), DeviceBindingAmbiguous);
});

test('PostgreSQL lookup contract parameterizes the device and rejects missing, revoked, or ambiguous results', async () => {
  // Query-contract fixture only; this does not execute a PostgreSQL database.
  const sample: ConsumerDeviceBinding = {
    binding_id: 'binding', subject_id: 'account', device_id: "device' OR 1=1 --",
    collector_subject_id: 'collector', status: 'active', display_name: null,
    platform: 'ios', app_version: null, bound_at: '2026-10-29T00:00:00.000Z', revoked_at: null,
  };
  let rows: ConsumerDeviceBinding[] = [];
  const queries: { text: string; values?: unknown[] }[] = [];
  const pool = { async query(text: string, values?: unknown[]) {
    queries.push({ text, values });
    return { rows: text.startsWith('SELECT') ? rows : [] };
  } } as unknown as Pool;
  const store = new PostgresConsumerDeviceBindingStore(pool);
  assert.equal(await store.findActiveByDeviceId(sample.device_id), null);
  rows = [sample];
  assert.deepEqual(await store.findActiveByDeviceId(sample.device_id), sample);
  rows = [{ ...sample, status: 'revoked' }];
  await assert.rejects(store.findActiveByDeviceId(sample.device_id), DeviceBindingRevoked);
  rows = [sample, { ...sample, binding_id: 'other' }];
  await assert.rejects(store.findActiveByDeviceId(sample.device_id), DeviceBindingAmbiguous);
  const selects = queries.filter(query => query.text.startsWith('SELECT'));
  assert.equal(selects.length, 4);
  for (const query of selects) {
    assert.equal(query.text, 'SELECT * FROM consumer_device_bindings WHERE device_id=$1 ORDER BY bound_at DESC');
    assert.deepEqual(query.values, [sample.device_id]);
  }
});
