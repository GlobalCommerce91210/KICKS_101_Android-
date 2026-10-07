import { pathToFileURL } from 'node:url';

// Read-only: no account creation, application bearer token, or database writes.
export async function checkIdentityRoute(baseUrl, credentials = {}) {
  const origin = new URL(baseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')) {
    throw new Error('Use HTTPS for remote origins. HTTP is allowed only on loopback.');
  }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new Error('Provide only the API origin, without credentials, path, query, or fragment.');
  }
  const headers = { accept: 'application/json' };
  if (Boolean(credentials.clientId) !== Boolean(credentials.clientSecret)) {
    throw new Error('Both Cloudflare service credential environment variables are required together.');
  }
  if (credentials.clientId) {
    headers['CF-Access-Client-Id'] = credentials.clientId;
    headers['CF-Access-Client-Secret'] = credentials.clientSecret;
  }
  async function read(path) {
    const response = await fetch(new URL(path, origin), {
      headers, redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error(`${path}: HTTP ${response.status}, non-JSON response; check Access policy and API origin routing.`);
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`${path}: HTTP ${response.status}, invalid JSON response.`); }
    return { status: response.status, body };
  }
  const health = await read('/health');
  if (health.status !== 200 || health.body.status !== 'ok' || health.body.service !== 'kicks-api') {
    throw new Error(`/health: HTTP ${health.status}, expected healthy kicks-api origin.`);
  }
  const account = await read('/core/identity/v1/account');
  if (account.status === 404) {
    throw new Error('Identity route missing (HTTP 404). Check deployed commit, API startup command, and origin routing.');
  }
  if (account.status !== 401 || account.body.error !== 'unauthorized') {
    throw new Error(`Identity route: HTTP ${account.status}, expected application 401 unauthorized without a bearer token.`);
  }
  return { health: 'ok', identityRoute: 'registered', authentication: 'required' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run check:identity-route --workspace @kicks/api -- https://API_HOST');
    const result = await checkIdentityRoute(process.argv[2], {
      clientId: process.env.CF_ACCESS_CLIENT_ID,
      clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Never print response bodies, headers, origins, or underlying network errors.
    console.error(error instanceof TypeError ? 'Request failed; check network connectivity and API origin.' : error.message);
    process.exitCode = 1;
  }
}
