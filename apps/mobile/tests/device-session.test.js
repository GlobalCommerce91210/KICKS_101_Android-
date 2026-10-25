const assert = require('node:assert/strict');
const test = require('node:test');
const secureStore = require('expo-secure-store');
const {
  createDeviceCredentialStorage
} = require('../services/deviceCredentialStorage.ts');
const {
  DeviceSessionError,
  DeviceSessionManager
} = require('../services/deviceSession.ts');

const credentials = {
  deviceId: '123e4567-e89b-42d3-a456-426614174000',
  subjectId: '123e4567-e89b-42d3-a456-426614174001',
  deviceToken: 'a-valid-device-token-value'
};
const baseUrl = 'https://consent.example.test';

function makeStorage(initial = null) {
  let value = initial;
  let writes = 0;
  let clears = 0;
  return {
    storage: {
      async read() { return value; },
      async write(next) { value = next; writes += 1; },
      async clear() { value = null; clears += 1; }
    },
    get value() { return value; },
    get writes() { return writes; },
    get clears() { return clears; }
  };
}

test('secure credential storage keeps one credential record and uses device-only iOS Keychain access', async () => {
  let savedValue = null;
  let savedOptions;
  const adapter = {
    async getItemAsync() { return savedValue; },
    async setItemAsync(_key, value, options) {
      savedValue = value;
      savedOptions = options;
    },
    async deleteItemAsync() { savedValue = null; }
  };
  const storage = createDeviceCredentialStorage(adapter, 'ios');

  await storage.write(credentials);
  assert.deepEqual(JSON.parse(savedValue), credentials);
  assert.equal(savedOptions.keychainAccessible, secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY);
  assert.deepEqual(await storage.read(), credentials);
  await storage.clear();
  assert.equal(savedValue, null);
});

test('malformed secure credential records are deleted instead of restored', async () => {
  let deleted = false;
  const storage = createDeviceCredentialStorage({
    async getItemAsync() { return '{"deviceToken":"incomplete"}'; },
    async setItemAsync() {},
    async deleteItemAsync() { deleted = true; }
  }, 'android');

  assert.equal(await storage.read(), null);
  assert.equal(deleted, true);
});

test('device session restoration validates server identity and clears credentials on 401', async () => {
  const state = makeStorage(credentials);
  let request;
  const manager = new DeviceSessionManager(
    state.storage,
    () => baseUrl,
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        deviceId: credentials.deviceId,
        subjectId: credentials.subjectId
      }), { status: 200 });
    }
  );

  assert.deepEqual(await manager.restoreSession(), credentials);
  assert.equal(request.url, `${baseUrl}/v1/devices/session`);
  assert.equal(request.init.headers.authorization, 'Bearer ' + credentials.deviceToken);

  const unauthorized = new DeviceSessionManager(
    state.storage,
    () => baseUrl,
    async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  );
  assert.equal(await unauthorized.restoreSession(), null);
  assert.equal(state.value, null);
  assert.equal(state.clears, 1);
});

test('device session restoration rejects a server identity that differs from stored credentials', async () => {
  const state = makeStorage(credentials);
  const manager = new DeviceSessionManager(
    state.storage,
    () => baseUrl,
    async () => new Response(JSON.stringify({
      deviceId: credentials.deviceId,
      subjectId: '123e4567-e89b-42d3-a456-426614174099'
    }), { status: 200 })
  );

  await assert.rejects(
    manager.restoreSession(),
    error => error instanceof DeviceSessionError && error.code === 'invalid_session_response'
  );
  assert.equal(state.value, null);
  assert.equal(state.clears, 1);
});

test('enrollment fails closed until an identity token provider is registered', async () => {
  const state = makeStorage();
  let requests = 0;
  const manager = new DeviceSessionManager(state.storage, () => baseUrl, async () => {
    requests += 1;
    return new Response('{}', { status: 200 });
  });

  await assert.rejects(
    manager.enrollDevice(),
    error => error instanceof DeviceSessionError && error.code === 'identity_provider_unavailable'
  );
  assert.equal(requests, 0);
  assert.equal(state.writes, 0);
});

test('account session status distinguishes an unregistered provider from stored credentials', async () => {
  const state = makeStorage();
  const manager = new DeviceSessionManager(state.storage, () => baseUrl, async () => {
    throw new Error('not expected');
  });

  assert.equal(manager.hasIdentityTokenProvider(), false);
  assert.equal(await manager.hasStoredSession(), false);
  manager.setIdentityTokenProvider(async () => null);
  assert.equal(manager.hasIdentityTokenProvider(), true);
  await state.storage.write(credentials);
  assert.equal(await manager.hasStoredSession(), true);
});

test('enrollment sends only the provider ID token and stores validated server credentials once', async () => {
  const state = makeStorage();
  let request;
  const manager = new DeviceSessionManager(
    state.storage,
    () => baseUrl,
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        deviceId: credentials.deviceId,
        subjectId: credentials.subjectId,
        token: credentials.deviceToken,
        tokenType: 'Bearer'
      }), { status: 201 });
    }
  );
  manager.setIdentityTokenProvider(async () => 'provider-issued-id-token');

  assert.deepEqual(await manager.enrollDevice(), credentials);
  assert.equal(request.url, `${baseUrl}/v1/devices/enroll`);
  assert.equal(request.init.method, 'POST');
  assert.ok(request.init.headers.authorization.endsWith('provider-issued-id-token'));
  assert.equal(Object.hasOwn(request.init, 'body'), false);
  assert.equal(state.writes, 1);
});

test('logout clears credentials even when remote revocation is unavailable', async () => {
  const state = makeStorage(credentials);
  const manager = new DeviceSessionManager(
    state.storage,
    () => baseUrl,
    async () => { throw new Error('offline'); }
  );

  assert.deepEqual(await manager.logout(), { remoteRevocationConfirmed: false });
  assert.equal(state.value, null);
  assert.equal(state.clears, 1);
});

test('logout reports confirmed remote revocation only after a matching server response', async () => {
  const state = makeStorage(credentials);
  const manager = new DeviceSessionManager(
    state.storage,
    () => baseUrl,
    async () => new Response(JSON.stringify({
      deviceId: credentials.deviceId,
      revoked: true
    }), { status: 200 })
  );

  assert.deepEqual(await manager.logout(), { remoteRevocationConfirmed: true });
  assert.equal(state.value, null);
  assert.equal(state.clears, 1);
});

test('Settings exposes session status and logout without adding an enrollment UI', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const screen = fs.readFileSync(path.join(__dirname, '../app/settings.tsx'), 'utf8');
  const permissions = fs.readFileSync(path.join(__dirname, '../app/permissions.tsx'), 'utf8');

  assert.match(screen, /logoutDevice/);
  assert.match(screen, /Log out and revoke/);
  assert.match(screen, /remoteRevocationConfirmed/);
  assert.match(screen, /no identity-token provider is registered/);
  assert.doesNotMatch(screen, /password|sign in|login form/i);
  assert.match(permissions, /error\.status === 503/);
  assert.match(permissions, /setLoadState\(sessionUnavailable/);
});
