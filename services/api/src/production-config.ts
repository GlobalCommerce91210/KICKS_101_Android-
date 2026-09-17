export interface ProductionRuntimeConfig {
  environment: 'staging' | 'production';
  databaseUrl?: string;
  publicApiUrl?: string;
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
