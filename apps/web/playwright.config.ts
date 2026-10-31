import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a real server + PostgreSQL/PostGIS.
 * The database in E2E_DATABASE_URL is wiped before the server starts.
 *   pnpm --filter @nodara/web build && pnpm test:e2e
 */
const PORT = Number(process.env.E2E_PORT ?? 8091);
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://nodara:nodara@localhost:5432/nodara_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Wipe the e2e database, then start the server (which applies migrations).
    command: `psql "${DB}" -q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" && pnpm --filter @nodara/server exec tsx src/index.ts`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: DB,
      PORT: String(PORT),
      PUBLIC_URL: `http://localhost:${PORT}`,
      WEB_DIST: new URL('./dist', import.meta.url).pathname,
      REGISTRATION_POLICY: 'invite',
      DISABLE_JOBS: 'true',
      LOG_LEVEL: 'warn',
    },
  },
});
