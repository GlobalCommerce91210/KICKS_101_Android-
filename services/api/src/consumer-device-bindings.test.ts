import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryConsumerDeviceBindingStore, DeviceOwnershipConflict } from './consumer-device-bindings.js';

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
