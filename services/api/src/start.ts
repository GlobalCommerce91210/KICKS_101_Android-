import { buildServer } from './server.js';

const app = buildServer();
app.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
})
  .catch(error => { app.log.error(error); process.exit(1); });
