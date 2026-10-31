import { afterAll, beforeAll } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createDb, type Sql } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import type { Ctx } from '../src/context.js';

export interface TestEnv {
  app: FastifyInstance;
  ctx: Ctx;
  sql: Sql;
}

let shared: Promise<TestEnv> | null = null;

async function create(): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    PUBLIC_URL: 'http://localhost:5173',
    REGISTRATION_POLICY: 'open',
    DISABLE_JOBS: 'true',
    LOG_LEVEL: 'silent',
    WEB_DIST: '/nonexistent',
  });
  const sql = createDb(config.DATABASE_URL, 5);
  await migrate(sql);
  const { app, ctx } = await buildApp(config, { sql, logger: false });
  await app.ready();
  return { app, ctx, sql };
}

/** One app + DB per test file; tables are truncated between files. */
export function useTestEnv() {
  const env = {} as TestEnv;
  beforeAll(async () => {
    shared ??= create();
    Object.assign(env, await shared);
    await env.sql.unsafe(`
      TRUNCATE users, circles, system_settings, audit_log, geocode_cache, ingest_stats RESTART IDENTITY CASCADE`);
    env.ctx.settings.invalidate();
    // Keep the VAPID keys the push service generated.
    await env.ctx.push.init();
  });
  afterAll(async () => {});
  return env;
}

/** A tiny cookie-jar client around fastify.inject. */
let ipSeq = 0;

export class Client {
  cookie = '';
  // Each simulated person gets their own address so per-IP rate limits behave realistically.
  private ip = `10.0.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      remoteAddress: this.ip,
      payload: body === undefined ? undefined : (body as object),
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== 'GET' ? { 'x-nodara-request': '1' } : {}),
        ...headers,
      },
    });
    const set = res.headers['set-cookie'];
    const list = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of list) {
      const [pair] = c.split(';');
      if (pair!.startsWith('nodara_session=')) this.cookie = pair!.endsWith('=') ? '' : pair!;
    }
    return res;
  }
  get = (url: string, headers?: Record<string, string>) => this.req('GET', url, undefined, headers);
  post = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.req('POST', url, body, headers);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);
  put = (url: string, body: unknown = {}) => this.req('PUT', url, body);
  del = (url: string, body?: unknown) => this.req('DELETE', url, body);
}

let counter = 0;
export async function newUser(env: TestEnv, name = 'User'): Promise<{ client: Client; id: string; email: string; deviceId: string }> {
  const client = new Client(env.app);
  const email = `${name.toLowerCase().replace(/\s+/g, '')}${++counter}@example.com`;
  const { n } = (await env.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE NOT is_demo`)[0]!;
  const path = n === 0 ? '/api/auth/setup' : '/api/auth/register';
  const res = await client.post(path, { email, password: 'correct horse battery', displayName: name });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.body}`);
  const id = res.json().user.id as string;
  const dev = await client.post('/api/devices', { name: 'Test phone', kind: 'web' });
  return { client, id, email, deviceId: dev.json().device.id };
}

export const json = (r: LightMyRequestResponse) => r.json();
