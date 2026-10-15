import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeEnvironment, validateProductionRuntimeConfig } from './production-config.js';

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

test('NODE_ENV=production with missing KICKS_ENVIRONMENT remains production and requires durable storage', () => {
  const environment = resolveRuntimeEnvironment({ nodeEnvironment: 'production' });

  assert.equal(environment, 'production');
  assert.throws(
    () => validateProductionRuntimeConfig({ environment, publicApiUrl: 'https://api.example.com' }),
    /in-memory fallback is forbidden/,
  );
});

test('NODE_ENV=production with missing KICKS_ENVIRONMENT requires the public HTTPS API URL', () => {
  const environment = resolveRuntimeEnvironment({ nodeEnvironment: 'production' });

  assert.throws(
    () => validateProductionRuntimeConfig({ environment, databaseUrl: 'postgres://example' }),
    /KICKS_PUBLIC_API_URL/,
  );
  assert.throws(
    () => validateProductionRuntimeConfig({
      environment,
      databaseUrl: 'postgres://example',
      publicApiUrl: 'http://api.example.com',
    }),
    /must use HTTPS/,
  );
});

test('NODE_ENV=production rejects invalid or misspelled KICKS_ENVIRONMENT values', () => {
  for (const kicksEnvironment of ['prod', 'Production', 'stageing']) {
    assert.throws(
      () => resolveRuntimeEnvironment({ nodeEnvironment: 'production', kicksEnvironment }),
      /must be either staging or production/,
    );
  }
});

test('NODE_ENV=production cannot be explicitly downgraded to staging', () => {
  assert.throws(
    () => resolveRuntimeEnvironment({ nodeEnvironment: 'production', kicksEnvironment: 'staging' }),
    /cannot run with KICKS_ENVIRONMENT=staging/,
  );
});

test('NODE_ENV=production with missing KICKS_ENVIRONMENT accepts complete durable production config', () => {
  const environment = resolveRuntimeEnvironment({ nodeEnvironment: 'production' });

  assert.doesNotThrow(() => validateProductionRuntimeConfig({
    environment,
    databaseUrl: 'postgres://example',
    publicApiUrl: 'https://api.example.com',
  }));
});
