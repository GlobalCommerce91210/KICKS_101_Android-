import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export interface OidcConfig {
  issuer: string;
  audience: string;
  /** Returns the trusted signing keys (a JWKS "keys" array). Called again when a kid is unknown. */
  getKeys: () => Promise<JsonWebKey[]>;
  now?: () => number;
  leewaySeconds?: number;
}

export interface OidcIdentity { sub: string; jti?: string; exp: number }

const b64 = (s: string) => Buffer.from(s, 'base64url');
const ALGS: Record<string, { hash: string; kty: string; ieee?: boolean }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  ES256: { hash: 'sha256', kty: 'EC', ieee: true }
};

/** Verifies an OIDC access/ID token: signature (RS256/ES256 only), issuer, audience, exp/nbf and a stable sub. */
export function createOidcVerifier(config: OidcConfig) {
  const now = config.now ?? (() => Date.now());
  const leeway = config.leewaySeconds ?? 30;
  return async (token: string): Promise<OidcIdentity | null> => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const header = JSON.parse(b64(parts[0]!).toString('utf8'));
      const alg = ALGS[header.alg];
      if (!alg || typeof header.kid !== 'string') return null;
      let keys = await config.getKeys();
      let jwk = keys.find(k => (k as { kid?: string }).kid === header.kid && k.kty === alg.kty);
      if (!jwk) { keys = await config.getKeys(); jwk = keys.find(k => (k as { kid?: string }).kid === header.kid && k.kty === alg.kty); }
      if (!jwk) return null;
      const ok = verify(
        alg.hash,
        Buffer.from(`${parts[0]}.${parts[1]}`),
        alg.ieee ? { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' } : createPublicKey({ key: jwk, format: 'jwk' }),
        b64(parts[2]!)
      );
      if (!ok) return null;
      const c = JSON.parse(b64(parts[1]!).toString('utf8'));
      const t = now() / 1000;
      if (c.iss !== config.issuer) return null;
      const aud: unknown[] = Array.isArray(c.aud) ? c.aud : [c.aud];
      if (!aud.includes(config.audience)) return null;
      if (typeof c.exp !== 'number' || c.exp + leeway <= t) return null;
      if (c.nbf !== undefined && (typeof c.nbf !== 'number' || c.nbf - leeway > t)) return null;
      if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) return null;
      return { sub: c.sub, jti: typeof c.jti === 'string' ? c.jti : undefined, exp: c.exp };
    } catch { return null; }
  };
}

/** Fetches and caches the issuer's JWKS (https only). */
export function jwksFetcher(uri: string, ttlMs = 10 * 60_000, fetchImpl: typeof fetch = fetch) {
  if (!uri.startsWith('https://')) throw new Error('JWKS URI must use https');
  let cache: { at: number; keys: JsonWebKey[] } | undefined;
  return async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.keys;
    const res = await fetchImpl(uri, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`jwks_${res.status}`);
    const body = (await res.json()) as { keys?: JsonWebKey[] };
    cache = { at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
    return cache.keys;
  };
}

export function oidcFromEnv(env = process.env) {
  const { KICKS_OIDC_ISSUER: issuer, KICKS_OIDC_AUDIENCE: audience, KICKS_OIDC_JWKS_URI: jwks } = env;
  if (!issuer || !audience || !jwks) return undefined;
  return createOidcVerifier({ issuer, audience, getKeys: jwksFetcher(jwks) });
}
