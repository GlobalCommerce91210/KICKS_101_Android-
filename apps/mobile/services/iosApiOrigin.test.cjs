const test = require('node:test');
const assert = require('node:assert/strict');
const { requireIosApiOrigin } = require('./iosApiOrigin.js');
test('accepts a configured HTTPS origin', () => assert.equal(requireIosApiOrigin('https://api.example.test/'), 'https://api.example.test'));
for (const value of [undefined, '', 'garbage', 'http://api.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://u:p@api.example.test', 'https://api.example.test/path', 'https://api.example.test?token=secret', 'https://api.example.test#fragment']) {
  test(`rejects invalid origin ${String(value).replace('secret', 'redacted')}`, () => assert.throws(() => requireIosApiOrigin(value)));
}
