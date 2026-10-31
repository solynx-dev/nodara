import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { startJobs } from './services/jobs.js';

const config = loadConfig();
const { app, ctx } = await buildApp(config);

await migrate(ctx.sql, (m) => app.log.info(m));
const stopJobs = config.DISABLE_JOBS ? () => {} : startJobs(ctx);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopJobs();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
