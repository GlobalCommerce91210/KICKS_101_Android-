import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionRuntimeConfig } from './production-config.js';

test('staging may run without production-only config', () => {
  assert.doesNotThrow(() => validateProductionRuntimeConfig({ environment: 'staging' }));
});

test('production refuses to start without a durable database URL', () => {
  assert.throws(
    () => validateProductionRuntimeConfig({ environment: 'production', publicApiUrl: 'https://api.example.com' }),
    /in-memory fallback is forbidden/,
  );
});

test('production refuses to start without an explicit public API URL', () => {
  assert.throws(
    () => validateProductionRuntimeConfig({ environment: 'production', databaseUrl: 'postgres://example' }),
    /KICKS_PUBLIC_API_URL/,
  );
});

test('production refuses non-HTTPS public API URLs', () => {
  assert.throws(
    () => validateProductionRuntimeConfig({
      environment: 'production',
      databaseUrl: 'postgres://example',
      publicApiUrl: 'http://api.example.com',
    }),
    /must use HTTPS/,
  );
});

test('production accepts durable database plus HTTPS public API URL', () => {
  assert.doesNotThrow(() => validateProductionRuntimeConfig({
    environment: 'production',
    databaseUrl: 'postgres://example',
    publicApiUrl: 'https://api.example.com',
  }));
});
