import { buildServer } from './server.js';
import { validateProductionRuntimeConfig } from './production-config.js';

const environment = process.env.KICKS_ENVIRONMENT === 'production' ? 'production' : 'staging';
const databaseUrl = process.env.DATABASE_URL ?? process.env.KICKS_DATABASE_URL;

validateProductionRuntimeConfig({
  environment,
  databaseUrl,
  publicApiUrl: process.env.KICKS_PUBLIC_API_URL,
});

const app = buildServer({ environment });
app.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
})
  .catch(error => { app.log.error(error); process.exit(1); });
