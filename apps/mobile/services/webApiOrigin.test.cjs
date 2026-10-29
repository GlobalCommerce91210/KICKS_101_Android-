const test = require('node:test');
const assert = require('node:assert/strict');
const { selectWebApiOrigin } = require('./webApiOrigin.js');
const { requireIosApiOrigin } = require('./iosApiOrigin.js');
const validated = (explicitOrigin, locationOrigin) => requireIosApiOrigin(selectWebApiOrigin(explicitOrigin, locationOrigin));

test('HTTPS same-origin fallback passes the existing strict validator', () => {
  assert.equal(validated(undefined, 'https://app.example.test/'), 'https://app.example.test');
});
test('explicit valid HTTPS origin wins over same-origin fallback', () => {
  assert.equal(validated('https://api.example.test/', 'https://app.example.test/'), 'https://api.example.test');
});
test('invalid explicit origin does not fall back to location origin', () => {
  assert.throws(() => validated('http://api.example.test', 'https://app.example.test/'), /ios_api_requires_remote_https_origin/);
});
test('SSR with neither explicit origin nor window origin fails closed', () => {
  assert.throws(() => selectWebApiOrigin(undefined, undefined), /web_api_origin_unavailable/);
});
for (const value of ['http://api.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://0.0.0.0']) {
  test(`HTTP or loopback origin is rejected: ${value}`, () => assert.throws(() => validated(value, 'https://app.example.test/')));
}
