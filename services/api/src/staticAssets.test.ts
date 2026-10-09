import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStaticAsset } from './staticAssets.js';

test('SPA fallback never masks missing identity, consumer, or API routes', t => {
  const root = mkdtempSync(join(tmpdir(), 'kicks-static-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'index.html'), '<html>Fixture app</html>');
  for (const path of ['/core/identity/v1/missing', '/core/consumer/v1/missing', '/v1/me/missing', '/api/missing', '/%63ore/identity/v1/missing']) {
    assert.equal(resolveStaticAsset(root, path), null);
  }
  assert.equal(resolveStaticAsset(root, '/account?returnTo=profile'), join(root, 'index.html'));
  assert.equal(resolveStaticAsset(root, '/profile'), join(root, 'index.html'));
});

test('static lookup refuses traversal and malformed encodings while serving real assets', t => {
  const root = mkdtempSync(join(tmpdir(), 'kicks-static-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const assets = join(root, 'dist'); mkdirSync(assets);
  writeFileSync(join(assets, 'index.html'), '<html>Fixture app</html>');
  writeFileSync(join(assets, 'app.js'), '/* fixture */');
  writeFileSync(join(root, 'private.txt'), 'outside the public directory');
  for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/..%5cprivate.txt', '/%ZZ', '/%00']) {
    assert.equal(resolveStaticAsset(assets, path), null);
  }
  assert.equal(resolveStaticAsset(assets, '/app.js?v=1'), join(assets, 'app.js'));
});
