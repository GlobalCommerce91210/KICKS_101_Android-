import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.ts';
import { checkIdentityRoute } from './check-identity-route.mjs';

test('live API exposes identity route and requires application authentication', async (t) => {
  const app = buildServer();
  t.after(() => app.close());
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  assert.deepEqual(await checkIdentityRoute(origin), {
    health: 'ok', identityRoute: 'registered', authentication: 'required',
  });
});

for (const [name, status, body, contentType, expected] of [
  ['missing route', 404, { error: 'Not Found' }, 'application/json', /Identity route missing/],
  ['web fallback', 200, '<html>web app</html>', 'text/html', /non-JSON/],
  ['Access denial', 403, { error: 'forbidden' }, 'application/json', /HTTP 403/],
  ['unexpected successful anonymous access', 200, {}, 'application/json', /expected application 401/],
]) {
  test(`rejects ${name}`, async (t) => {
    const { default: Fastify } = await import('fastify');
    const app = Fastify();
    t.after(() => app.close());
    app.get('/health', async () => ({ status: 'ok', service: 'kicks-api' }));
    app.get('/core/identity/v1/account', async (_, reply) => reply.code(status).type(contentType).send(body));
    const origin = await app.listen({ port: 0, host: '127.0.0.1' });
    await assert.rejects(checkIdentityRoute(origin), expected);
  });
}

test('rejects remote plaintext and incomplete service credentials before sending a request', async () => {
  await assert.rejects(checkIdentityRoute('http://example.com'), /HTTPS/);
  await assert.rejects(checkIdentityRoute('https://example.com', { clientId: 'test' }), /required together/);
});
