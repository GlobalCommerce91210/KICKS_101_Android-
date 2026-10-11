import type { IosGatewayConfiguration } from './ios-gateway-enrollment.js';

// No endpoint, key or reviewed purpose is invented by the launcher.
export function resolveIosGatewayRuntime(env: NodeJS.ProcessEnv, environment: 'staging' | 'production') {
  if (env.KICKS_IOS_GATEWAY_ENABLED !== 'true') return null;
  if (environment !== 'staging' || !(env.DATABASE_URL ?? env.KICKS_DATABASE_URL)) {
    throw new Error('iOS gateway requires durable staging storage');
  }
  const required = ['KICKS_IOS_GATEWAY_HOST', 'KICKS_IOS_GATEWAY_PORT', 'KICKS_IOS_GATEWAY_PUBLIC_KEY',
    'KICKS_IOS_GATEWAY_AUTHORITY_SECRET', 'KICKS_MONITORING_PERMISSION_ID', 'KICKS_MONITORING_PURPOSE',
    'KICKS_MONITORING_PURPOSE_VERSION', 'KICKS_MONITORING_POLICY_VERSION'] as const;
  for (const name of required) if (!env[name]?.trim()) throw new Error(`Missing ${name}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.KICKS_MONITORING_PERMISSION_ID!)) throw new Error('Invalid monitoring permission ID');
  const secret = env.KICKS_IOS_GATEWAY_AUTHORITY_SECRET!;
  if (secret.length < 32 || /\s/.test(secret) || secret === env.KICKS_STAGING_ADMIN_SECRET) throw new Error('Gateway authority requires a separate secret of at least 32 characters');
  const config: IosGatewayConfiguration = {
    environment: 'staging', serverHost: env.KICKS_IOS_GATEWAY_HOST!, serverPort: Number(env.KICKS_IOS_GATEWAY_PORT),
    serverPublicKey: env.KICKS_IOS_GATEWAY_PUBLIC_KEY!, purpose: env.KICKS_MONITORING_PURPOSE!,
    purposeVersion: env.KICKS_MONITORING_PURPOSE_VERSION!, policyVersion: env.KICKS_MONITORING_POLICY_VERSION!,
    permissionId: env.KICKS_MONITORING_PERMISSION_ID!,
  };
  return { config, secret, permissionId: env.KICKS_MONITORING_PERMISSION_ID! };
}
