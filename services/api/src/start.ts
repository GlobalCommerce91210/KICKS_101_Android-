import { Pool } from 'pg';
import { buildServer, trustedProxyAllowlistFromEnv } from './server.js';
import { PostgresConsentRepository } from './consent-repository.js';
import { PostgresDeviceRepository } from './device-repository.js';
import { PostgresMetadataRepository } from './metadata-repository.js';
import { createOidcVerifier, oidcConfigFromEnv } from './oidc.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required; refusing to start the API with in-memory consent state.');
}

const oidcConfig = oidcConfigFromEnv();
const trustedProxies = trustedProxyAllowlistFromEnv(process.env.API_TRUSTED_PROXIES);
const pool = new Pool({ connectionString });
const app = buildServer({
  consentRepository: new PostgresConsentRepository(pool),
  deviceRepository: new PostgresDeviceRepository(pool),
  metadataRepository: new PostgresMetadataRepository(pool),
  ...(oidcConfig ? { identityVerifier: createOidcVerifier(oidcConfig) } : {}),
  trustedProxies
});
app.addHook('onClose', async () => { await pool.end(); });

try {
  await pool.query('SELECT 1');
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
}
