import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveApiBaseUrl } from './apiEndpoint.ts';

test('native clients fail closed without a configured service', () => {
  for (const platform of ['ios', 'android']) assert.throws(() => resolveApiBaseUrl(platform, undefined), /not connected/);
});
test('web keeps same-origin development routing', () => {
  assert.equal(resolveApiBaseUrl('web', undefined, 'http://localhost:3000'), 'http://localhost:3000');
});
test('configured HTTPS endpoint supports base paths and removes trailing slash', () => {
  assert.equal(resolveApiBaseUrl('ios', ' https://beta.example.test/api/ '), 'https://beta.example.test/api');
});
test('rejects insecure, loopback, credential-bearing and malformed endpoints', () => {
  for (const url of ['http://beta.example.test', 'ftp://beta.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://user:password@beta.example.test', 'https://beta.example.test?token=secret', 'https://beta.example.test#token', 'invalid']) {
    assert.throws(() => resolveApiBaseUrl('ios', url));
  }
});
