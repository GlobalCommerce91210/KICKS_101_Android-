import { buildServer } from './server.js';
import { resolveRuntimeEnvironment } from './production-config.js';

const environment = resolveRuntimeEnvironment({
  nodeEnvironment: process.env.NODE_ENV,
  kicksEnvironment: process.env.KICKS_ENVIRONMENT,
});

const app = buildServer({ environment });
app.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
})
  .catch(error => { app.log.error(error); process.exit(1); });
