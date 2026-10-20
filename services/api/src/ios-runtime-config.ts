import type { IosGatewayConfiguration } from './ios-gateway-enrollment.js';

// No endpoint, key or reviewed purpose is invented by the launcher.
export function resolveIosGatewayRuntime(env: NodeJS.ProcessEnv, environment: 'staging' | 'production') {
  if (env.KICKS_IOS_GATEWAY_ENABLED !== 'true') return null;
  if (environment !== 'staging' || !(env.DATABASE_URL ?? env.KICKS_DATABASE_URL)) {
    throw new Error('iOS gateway requires durable staging storage');
  }
  const required = ['KICKS_IOS_GATEWAY_HOST', 'KICKS_IOS_GATEWAY_PORT', 'KICKS_IOS_GATEWAY_PUBLIC_KEY',
    'KICKS_IOS_GATEWAY_AUTHORITY_SECRET', 'KICKS_MONITORING_PERMISSION_ID', 'KICKS_MONITORING_PURPOSE',
    'KICKS_MONITORING_PURPOSE_VERSION', 'KICKS_MONITORING_POLICY_VERSION',
    'KICKS_COLLECTOR_REVOCATION_DATABASE_URL', 'KICKS_COLLECTOR_RECOVERY_EPOCH'] as const;
  for (const name of required) if (!env[name]?.trim()) throw new Error(`Missing ${name}`);
  const primary = new URL((env.DATABASE_URL ?? env.KICKS_DATABASE_URL)!);
  const authority = new URL(env.KICKS_COLLECTOR_REVOCATION_DATABASE_URL!);
  if (!['postgres:', 'postgresql:'].includes(authority.protocol) ||
      (primary.hostname === authority.hostname && primary.port === authority.port && primary.pathname === authority.pathname)) {
    throw new Error('Separate collector recovery database required');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.KICKS_COLLECTOR_RECOVERY_EPOCH!)) throw new Error('Invalid recovery epoch');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.KICKS_MONITORING_PERMISSION_ID!)) throw new Error('Invalid monitoring permission ID');
  const key = env.KICKS_IOS_GATEWAY_PUBLIC_KEY!;
  const port = Number(env.KICKS_IOS_GATEWAY_PORT);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').toString('base64') !== key ||
      Buffer.from(key, 'base64').every(byte => byte === 0) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[a-zA-Z0-9.-]+$/.test(env.KICKS_IOS_GATEWAY_HOST!) ||
      env.KICKS_MONITORING_PURPOSE!.length < 3 || env.KICKS_MONITORING_PURPOSE!.length > 120 ||
      env.KICKS_MONITORING_PURPOSE_VERSION!.length > 64 || env.KICKS_MONITORING_POLICY_VERSION!.length > 64) {
    throw new Error('Invalid reviewed gateway configuration');
  }
  const secret = env.KICKS_IOS_GATEWAY_AUTHORITY_SECRET!;
  if (secret.length < 32 || /\s/.test(secret) || secret === env.KICKS_STAGING_ADMIN_SECRET) throw new Error('Gateway authority requires a separate secret of at least 32 characters');
  const config: IosGatewayConfiguration = {
    environment: 'staging', serverHost: env.KICKS_IOS_GATEWAY_HOST!, serverPort: Number(env.KICKS_IOS_GATEWAY_PORT),
    serverPublicKey: env.KICKS_IOS_GATEWAY_PUBLIC_KEY!, purpose: env.KICKS_MONITORING_PURPOSE!,
    purposeVersion: env.KICKS_MONITORING_PURPOSE_VERSION!, policyVersion: env.KICKS_MONITORING_POLICY_VERSION!,
    permissionId: env.KICKS_MONITORING_PERMISSION_ID!,
    recoveryEpoch: env.KICKS_COLLECTOR_RECOVERY_EPOCH!,
  };
  return { config, secret, permissionId: env.KICKS_MONITORING_PERMISSION_ID! };
}
