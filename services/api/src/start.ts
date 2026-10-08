import { buildServer } from './server.js';
import { configuredAccountProvider } from './accountProvider.js';

const app = buildServer({ accountProvider: configuredAccountProvider() });
app.listen({ port: 3000, host: '0.0.0.0' })
  .catch(error => { app.log.error(error); process.exit(1); });

