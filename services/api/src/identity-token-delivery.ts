import type { IdentityTokenNotifier } from './datastorm-identity-routes.js';

// The private delivery worker sends email/SMS; its URL is never a consumer URL.
export function createIdentityTokenNotifier(env: NodeJS.ProcessEnv, send = fetch): IdentityTokenNotifier | undefined {
  const endpoint = env.KICKS_IDENTITY_DELIVERY_URL;
  const secret = env.KICKS_IDENTITY_DELIVERY_SECRET;
  if (!endpoint && !secret) return undefined;
  let url: URL;
  try { url = new URL(endpoint!); } catch { throw new Error('Invalid identity delivery URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || !secret || secret.length < 32 || /\s/.test(secret)) {
    throw new Error('Identity delivery requires HTTPS and a private credential of at least 32 characters');
  }
  return async delivery => {
    try {
      const result = await send(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
        body: JSON.stringify(delivery) });
      await result.body?.cancel();
      if (!result.ok) throw new Error();
    } catch {
      // Never include the credential, token, email, URL or upstream response in logs.
      throw new Error('identity_token_delivery_failed');
    }
  };
}
