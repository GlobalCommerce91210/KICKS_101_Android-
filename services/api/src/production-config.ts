export interface ProductionRuntimeConfig {
  environment: 'staging' | 'production';
  databaseUrl?: string;
  publicApiUrl?: string;
}

export interface RuntimeEnvironmentInput {
  nodeEnvironment?: string;
  kicksEnvironment?: string;
}

export function resolveRuntimeEnvironment(input: RuntimeEnvironmentInput): 'staging' | 'production' {
  const kicksEnvironment = input.kicksEnvironment?.trim();

  if (kicksEnvironment && kicksEnvironment !== 'staging' && kicksEnvironment !== 'production') {
    throw new Error(`KICKS_ENVIRONMENT must be either staging or production; received ${JSON.stringify(kicksEnvironment)}.`);
  }

  if (input.nodeEnvironment === 'production') {
    if (kicksEnvironment === 'staging') {
      throw new Error('NODE_ENV=production cannot run with KICKS_ENVIRONMENT=staging.');
    }
    return 'production';
  }

  return kicksEnvironment === 'production' ? 'production' : 'staging';
}

export function validateProductionRuntimeConfig(config: ProductionRuntimeConfig): void {
  if (config.environment !== 'production') return;

  if (!config.databaseUrl?.trim()) {
    throw new Error('Production startup requires DATABASE_URL or KICKS_DATABASE_URL; in-memory fallback is forbidden.');
  }

  if (!config.publicApiUrl?.trim()) {
    throw new Error('Production startup requires KICKS_PUBLIC_API_URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(config.publicApiUrl);
  } catch {
    throw new Error('KICKS_PUBLIC_API_URL must be a valid absolute URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('KICKS_PUBLIC_API_URL must use HTTPS in production.');
  }
}
