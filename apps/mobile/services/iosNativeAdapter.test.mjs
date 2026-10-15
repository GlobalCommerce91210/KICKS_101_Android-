import test from 'node:test';
import assert from 'node:assert/strict';
import { selectIosNativeAdapter } from './iosNativeAdapter.mjs';
const bridge = () => Object.fromEntries(['getDeviceId','prepare','requestAuthorization','start','stop','getStatus'].map(name => [name, async () => {}]));
test('selects the Expo JSI module on iOS', () => {
  const expo = bridge();
  assert.equal(selectIosNativeAdapter('ios', expo, bridge()), expo);
});
test('supports existing legacy signed builds', () => {
  const legacy = bridge();
  assert.equal(selectIosNativeAdapter('ios', null, legacy), legacy);
});
test('rejects incomplete modules instead of attempting collection', () => {
  assert.equal(selectIosNativeAdapter('ios', { start() {} }, null), undefined);
});
test('never exposes an iOS adapter to Android or web', () => {
  for (const platform of ['android', 'web']) assert.equal(selectIosNativeAdapter(platform, bridge(), bridge()), undefined);
});

test('rejects a partially upgraded enrollment bridge', () => {
  const partial = { ...bridge(), provision: async () => 'device' };
  assert.equal(selectIosNativeAdapter('ios', partial, undefined), undefined);
});
