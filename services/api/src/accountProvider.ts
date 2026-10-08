import { AccountProviderError, type AccountSession, type DataStormAccountProvider, type ConsumerResource } from './account.js';

/** Server-to-server contract for the canonical DataStorm service, including Cloudflare-hosted staging. */
export function configuredAccountProvider(): DataStormAccountProvider | undefined {
  const value = process.env.DATASTORM_ACCOUNT_PROVIDER_ORIGIN;
  // Enable only after the staging provider implements the documented contract.
  if (!value || process.env.DATASTORM_ACCOUNT_PROVIDER_CONTRACT !== 'consumer-account-v1' || process.env.DATASTORM_ACCOUNT_ENV !== 'staging') return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('DataStorm staging account provider requires an HTTPS origin');
  const paths = {
    'consumer-state': '/v1/me/consumer-state', snapshot: '/core/consumer/v1/snapshot', devices: '/core/consumer/v1/devices',
    permissions: '/v1/me/permissions', consent: '/v1/me/consent', monitoring: '/v1/me/monitoring', wallet: '/v1/me/wallet'
  };
  async function request<T>(path: string, token?: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${url.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'x-datastorm-client': 'native', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new AccountProviderError(503, 'account_service_unavailable'); }
    if (!response.ok) throw new AccountProviderError(response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 409 ? 409 : response.status === 429 ? 429 : 503, response.status === 401 ? 'session_expired' : 'account_service_unavailable');
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new AccountProviderError(503, 'invalid_account_provider_response'); }
  }
  return {
    authenticate: (mode, credentials) => request<AccountSession>(`/core/identity/v1/session/${mode}`, undefined, credentials),
    async restore(token) {
      try { const response = await request<Omit<AccountSession, 'token'>>('/core/identity/v1/account', token); return { ...response, token }; }
      catch (error) { if (error instanceof AccountProviderError && error.status === 401) return null; throw error; }
    },
    logout: token => request<void>('/core/identity/v1/session/logout', token, {}),
    recover: email => request<void>('/core/identity/v1/session/recovery', undefined, { email }),
    resource: (session, resource) => request<ConsumerResource>(paths[resource], session.token),
    async controls(session) {
      const result = await request<{ consumer_id: string; controls: Record<string, string> }>('/core/identity/v1/controls', session.token);
      if (result.consumer_id !== session.account.consumer_id) throw new AccountProviderError(503, 'consumer_identity_mismatch');
      return result.controls;
    }
  };
}
