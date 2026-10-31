import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { startJobs } from './services/jobs.js';

const config = loadConfig();
const sql = createDb(config.DATABASE_URL, config.DATABASE_POOL_SIZE);

// Migrate before building the app: services (e.g. web push keys) read the schema on startup.
const applied = await migrate(sql, (m) => console.log(m));
const { app, ctx } = await buildApp(config, { sql });
if (applied.length) app.log.info(`Applied ${applied.length} migration(s)`);
const stopJobs = config.DISABLE_JOBS ? () => {} : startJobs(ctx);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopJobs();
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.PORT });
