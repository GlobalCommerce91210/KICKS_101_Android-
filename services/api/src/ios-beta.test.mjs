import test from 'node:test';
import assert from 'node:assert/strict';
import { IOS_BETA_STATUS, registerIosBetaRoutes, renderIosBeta } from './ios-beta.mjs';
test('tester page has no collection or enrollment form and no build invitation', () => {
  const html = renderIosBeta();
  assert.match(html, /Enrollment is not open yet/);
  assert.match(html, /Installation alone does not grant collection consent/);
  assert.doesNotMatch(html, /<form|<input|<script|f20f0ec3|user_demo|x-api-key/i);
});
test('status is closed and cannot be enabled by environment or mutation', () => {
  process.env.IOS_BETA_ENABLED = 'true';
  assert.equal(IOS_BETA_STATUS.enrollment, 'closed');
  assert.throws(() => { IOS_BETA_STATUS.enrollment = 'open'; });
  assert.throws(() => IOS_BETA_STATUS.blockers.pop());
  delete process.env.IOS_BETA_ENABLED;
});
test('enrollment rejects without reading submitted identity or device fields', async () => {
  const handlers = new Map();
  const app = { get: (path, fn) => handlers.set(`GET ${path}`, fn), post: (path, fn) => handlers.set(`POST ${path}`, fn) };
  registerIosBetaRoutes(app);
  assert.equal(handlers.size, 3);
  const headers = {}; let status; let payload;
  const reply = { header: (k,v) => {headers[k]=v; return reply;}, code: s => {status=s; return reply;}, send: p => {payload=p; return reply;} };
  const request = new Proxy({}, {get() {throw new Error('must not read submitted details');}});
  await handlers.get('POST /v1/beta/ios/enroll')(request, reply);
  assert.equal(status, 503);
  assert.deepEqual(payload, {error:'ios_beta_enrollment_closed',retryable:false});
  assert.equal(headers['cache-control'], 'no-store');
});
