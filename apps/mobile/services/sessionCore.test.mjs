import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager, SessionError } from './sessionCore.ts';

test('server sign-out failure still clears local credentials and reports the uncertainty', async () => {
    const f = fixture();
    const transport = async (url, init) => {
        if (init?.method === 'DELETE') throw new Error('offline');
        return f.transport(url, init);
    };
    const manager = new SessionManager(f.storage, () => 'https://beta.example.test', transport);
    await manager.login('owner@example.test', 'password');
    await assert.rejects(manager.logout(), /Server sign-out could not be confirmed/);
    assert.equal(manager.user, null);
    assert.equal(f.saved, null);
});
test('a stale restore cannot erase a newer sign-in', async () => {
    const f = fixture();
    await f.manager.login('owner@example.test', 'password');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const transport = async (url, init) => {
        if (String(url).endsWith('/session/refresh')) await gate;
        return f.transport(url, init);
    };
    const manager = new SessionManager(f.storage, () => 'https://beta.example.test', transport);
    const restore = manager.restore();
    await new Promise(resolve => setTimeout(resolve, 0));
    await manager.logout();
    await manager.login('owner@example.test', 'password');
    release();
    await assert.rejects(restore);
    assert.equal(manager.user?.subjectId, 'ds-sub');
    assert.equal(JSON.parse(f.saved).refreshToken, 'first-refresh');
});

function fixture(options = {}) {
    let saved = null;
    const calls = [];
    let refreshes = 0;
    let deny = false;
    const storage = { async read() { return saved; }, async write(value) { if (options.saveFails)
            throw new Error('storage'); saved = value; }, async clear() { saved = null; } };
    const transport = async (url, init = {}) => {
        const path = String(url).replace('https://beta.example.test', '');
        calls.push({ path, init });
        if (path.endsWith('/session/refresh')) {
            refreshes++;
            return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', token_type: 'Bearer', expires_in: 900 });
        }
        if (path.endsWith('/session') && init.method === 'POST')
            return Response.json({ access_token: 'first-access', refresh_token: 'first-refresh', token_type: 'Bearer', expires_in: options.expired ? 1 : 900 });
        if (path.endsWith('/session') && init.method === 'DELETE')
            return new Response(null, { status: 204 });
        if (path.endsWith('/account'))
            return Response.json({ subject_id: 'ds-sub', email: 'owner@example.test', account_status: 'active' });
        if (path.endsWith('/products/kicks'))
            return Response.json({ entitlement: { subject_id: 'ds-sub', status: options.badAccess ? 'revoked' : 'active' }, profile: { subject_id: 'ds-sub', status: 'active' } });
        if (deny)
            return new Response(null, { status: 401 });
        return Response.json({ devices: [] });
    };
    return { manager: new SessionManager(storage, () => 'https://beta.example.test', transport), storage, transport, calls, get saved() { return saved; }, get refreshes() { return refreshes; }, set deny(value) { deny = value; } };
}
test('stores only origin-bound refresh credentials and sends account requests with Bearer token', async () => {
    const f = fixture();
    await f.manager.login(' owner@example.test ', 'Never-Persist-This');
    assert.deepEqual(JSON.parse(f.saved), { origin: 'https://beta.example.test', refreshToken: 'first-refresh' });
    assert.ok(!f.saved.includes('Never-Persist-This'));
    assert.ok(!f.saved.includes('first-access'));
    assert.equal(f.manager.user?.subjectId, 'ds-sub');
    await f.manager.request('/core/consumer/v1/devices');
    assert.equal(new Headers(f.calls.at(-1).init.headers).get('authorization'), 'Bearer first-access');
});
test('restores through refresh rotation and rechecks account entitlement', async () => {
    const f = fixture();
    await f.manager.login('owner@example.test', 'password');
    const restored = new SessionManager(f.storage, () => 'https://beta.example.test', f.transport);
    await restored.restore();
    assert.equal(restored.user?.subjectId, 'ds-sub');
    assert.equal(JSON.parse(f.saved).refreshToken, 'rotated-refresh');
});
test('rejects revoked access and secure-storage write failure', async () => {
    for (const options of [{ badAccess: true }, { saveFails: true }]) {
        const f = fixture(options);
        await assert.rejects(f.manager.login('owner@example.test', 'password'));
        assert.equal(f.manager.user, null);
        assert.equal(f.saved, null);
    }
});
test('does not send another environment refresh credential', async () => {
    const f = fixture();
    await f.manager.login('owner@example.test', 'password');
    let sent = false;
    const other = new SessionManager(f.storage, () => 'https://other.example.test', async () => { sent = true; throw new Error('must not send'); });
    await other.restore();
    assert.equal(sent, false);
    assert.equal(other.user, null);
    assert.equal(f.saved, null);
});
test('concurrent expiring requests share one token refresh', async () => {
    const f = fixture({ expired: true });
    await f.manager.login('owner@example.test', 'password');
    await Promise.all([f.manager.request('/core/consumer/v1/devices'), f.manager.request('/core/consumer/v1/devices')]);
    assert.equal(f.refreshes, 1);
});
test('401 clears the session and logout removes saved credentials', async () => {
    const f = fixture();
    await f.manager.login('owner@example.test', 'password');
    f.deny = true;
    await assert.rejects(f.manager.request('/core/consumer/v1/devices'), SessionError);
    assert.equal(f.manager.user, null);
    assert.equal(f.saved, null);
    assert.ok(f.calls.some(call => call.init.method === 'DELETE'));
});
test('logout during a pending login prevents session resurrection', async () => {
    const f = fixture();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const transport = async (url, init) => {
        if (String(url).endsWith('/session') && init?.method === 'POST')
            await gate;
        return f.transport(url, init);
    };
    const manager = new SessionManager(f.storage, () => 'https://beta.example.test', transport);
    const login = manager.login('owner@example.test', 'password');
    await new Promise(resolve => setTimeout(resolve, 0));
    await manager.logout();
    release();
    await assert.rejects(login);
    assert.equal(manager.user, null);
    assert.equal(f.saved, null);
});
test('rejects requests outside the account API', async () => {
    const f = fixture();
    await f.manager.login('owner@example.test', 'password');
    await assert.rejects(f.manager.request('https://external.example.test'));
});
