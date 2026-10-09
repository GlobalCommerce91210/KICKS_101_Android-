import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGateway } from './render-config.mjs';
const now = Date.parse('2026-10-08T00:00:00Z');
const peer = { publicKey: Buffer.alloc(32, 1).toString('base64'), address: '10.88.0.2', deviceId: 'device-1', consentId: 'consent-1', purposeVersion: 'approved-version', authorization: 'active', expiresAt: new Date(now + 60_000).toISOString() };
const configuration = (peers = [peer]) => ({ environment: 'staging', collectionEnabled: false, peers });
test('renders one isolated peer without private keys or identity disclosure', () => {
  const result = renderGateway(configuration(), now);
  assert.match(result, /AllowedIPs = 10\.88\.0\.2\/32/);
  assert.doesNotMatch(result, /PrivateKey|device-1|consent-1|0\.0\.0\.0\/0/);
});
test('empty authoritative peer set removes all peer entries', () => assert.equal(renderGateway(configuration([]), now), '[Interface]\nListenPort = 51820\n'));
for (const [name, change] of Object.entries({ revoked: { authorization: 'revoked' }, expired: { expiresAt: new Date(now).toISOString() }, unbounded: { expiresAt: new Date(now + 301_000).toISOString() }, unbound: { consentId: '' }, foreignSubnet: { address: '192.168.1.2' }, gatewayAddress: { address: '10.88.0.1' }, invalidKey: { publicKey: 'invalid' }, configInjection: { address: '10.88.0.2\nAllowedIPs = 0.0.0.0/0' } })) {
  test(`rejects ${name}`, () => assert.throws(() => renderGateway(configuration([{ ...peer, ...change }]), now)));
}
test('rejects duplicate peers', () => assert.throws(() => renderGateway(configuration([peer, peer]), now)));
test('rejects production and collection activation', () => {
  assert.throws(() => renderGateway({ ...configuration(), environment: 'production' }, now));
  assert.throws(() => renderGateway({ ...configuration(), collectionEnabled: true }, now));
});
