import { createRemoteJWKSet, jwtVerify } from 'jose';

type OidcKeyResolver = (
  ...args: Parameters<ReturnType<typeof createRemoteJWKSet>>
) => ReturnType<ReturnType<typeof createRemoteJWKSet>>;

export type OidcConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
};

export type VerifiedDeviceIdentity = {
  issuer: string;
  subject: string;
};

export interface DeviceIdentityVerifier {
  verify(token: string): Promise<VerifiedDeviceIdentity>;
}

export class OidcVerificationError extends Error {
  constructor(readonly kind: 'invalid' | 'unavailable', options?: ErrorOptions) {
    super(kind === 'invalid' ? 'OIDC identity token is invalid' : 'OIDC identity provider is unavailable', options);
    this.name = 'OidcVerificationError';
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function oidcConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim() ?? '';
  const audience = env.OIDC_AUDIENCE?.trim() ?? '';
  const jwksUrl = env.OIDC_JWKS_URL?.trim() ?? '';
  if (!issuer && !audience && !jwksUrl) return null;
  if (!issuer || !audience || !jwksUrl || !isHttpsUrl(issuer) || !isHttpsUrl(jwksUrl)) {
    throw new Error('OIDC_ISSUER, OIDC_AUDIENCE, and OIDC_JWKS_URL must be configured with HTTPS issuer and JWKS URLs');
  }
  return { issuer, audience, jwksUrl };
}

function isTokenValidationError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' &&
    (code.startsWith('ERR_JWT_') || code.startsWith('ERR_JWS_') ||
      code.startsWith('ERR_JOSE_') || code === 'ERR_JWKS_NO_MATCHING_KEY');
}

export function createOidcVerifier(
  config: OidcConfig,
  keyResolver: OidcKeyResolver = createRemoteJWKSet(new URL(config.jwksUrl))
): DeviceIdentityVerifier {
  return {
    async verify(token: string): Promise<VerifiedDeviceIdentity> {
      try {
        const { payload } = await jwtVerify(token, keyResolver, {
          algorithms: ['RS256', 'ES256'],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims: ['exp', 'sub']
        });
        const audience = payload.aud;
        const exactAudience = typeof audience === 'string'
          ? audience === config.audience
          : Array.isArray(audience) && audience.length === 1 && audience[0] === config.audience;
        if (payload.iss !== config.issuer || !exactAudience ||
          typeof payload.sub !== 'string' || !payload.sub.trim()) {
          throw new OidcVerificationError('invalid');
        }
        return { issuer: config.issuer, subject: payload.sub };
      } catch (error) {
        if (error instanceof OidcVerificationError) throw error;
        throw new OidcVerificationError(isTokenValidationError(error) ? 'invalid' : 'unavailable', { cause: error });
      }
    }
  };
}
