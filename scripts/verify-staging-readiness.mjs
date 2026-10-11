// Non-destructive public boundary probe. This is not an end-to-end device test.
const origin = process.argv[2] ?? 'https://staging-api.datastorminc.live';
const url = new URL(origin);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS API origin');
let failures = 0;
for (const [path, status, method] of [
  ['/health', 200, 'GET'], ['/core/identity/v1/account', 401, 'GET'],
  ['/core/consumer/v1/profile', 401, 'GET'], ['/core/consumer/v1/monitoring-policy', 401, 'GET'],
  ['/core/identity/v1/account', 422, 'POST'],
]) {
  try {
    const response = await fetch(origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      ...(method === 'POST' ? {headers: {'content-type':'application/json'}, body:'{}'} : {}) });
    const ok = response.status === status;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path}: HTTP ${response.status}, expected ${status}`);
    if (!ok) failures++;
    if (path === '/health' && ok) {
      const health = await response.json();
      for (const [name, ready] of Object.entries({ durableStaging: health.durability === 'postgres' && health.environment === 'staging',
        emailDeliveryConfigured: health.onboarding?.emailDeliveryConfigured === true,
        iosProvisioningConfigured: health.onboarding?.iosProvisioningConfigured === true,
        iosGatewayConfigured: health.onboarding?.iosGatewayConfigured === true })) {
        console.log(`${ready ? 'PASS' : 'FAIL'} ${name}`);
        if (!ready) failures++;
      }
    } else await response.body?.cancel();
  } catch { console.log(`FAIL ${method} ${path}: connection or response unavailable`); failures++; }
}
console.log('Required separately: real email receipt/confirmation, persistent session/profile, gateway revocation/expiry/outage and signed iPad VPN/ingestion evidence.');
process.exitCode = failures ? 1 : 0;
