import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { createDb, type Sql } from './db/index.js';
import { HttpError } from './lib/errors.js';
import { registerAuth } from './auth.js';
import { RealtimeHub } from './services/realtime.js';
import { SettingsService } from './services/settings.js';
import { PushService } from './services/push.js';
import { NotificationService } from './services/notify.js';
import { Mailer } from './services/mailer.js';
import { Geocoder } from './services/geocoder.js';
import authRoutes from './modules/auth.js';
import passkeyRoutes from './modules/passkeys.js';
import circleRoutes from './modules/circles.js';
import locationRoutes from './modules/locations.js';
import tripRoutes from './modules/trips.js';
import placeRoutes from './modules/places.js';
import notificationRoutes from './modules/notifications.js';
import deviceRoutes from './modules/devices.js';
import accountRoutes from './modules/account.js';
import adminRoutes from './modules/admin.js';
import systemRoutes from './modules/system.js';
import realtimeRoutes from './modules/realtime.js';

export interface BuiltApp {
  app: FastifyInstance;
  ctx: Ctx;
}

export async function buildApp(config: Config, opts: { sql?: Sql; logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });
  const sql = opts.sql ?? createDb(config.DATABASE_URL, config.DATABASE_POOL_SIZE);

  const hub = new RealtimeHub();
  const settings = new SettingsService(sql, config);
  const push = new PushService(sql, config, settings, app.log);
  const ctx: Ctx = {
    sql,
    config,
    log: app.log,
    hub,
    settings,
    push,
    notify: new NotificationService(sql, hub, push),
    mailer: new Mailer(config, app.log),
    geocoder: new Geocoder(sql, config, settings, app.log),
  };
  await push.init().catch((err) => app.log.warn({ err }, 'web push disabled'));

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Map tiles, glyphs and sprites come from the configured tile servers.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
        fontSrc: ["'self'", 'data:', 'https:'],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.secureCookies ? { maxAge: 31536000, includeSubDomains: false } : false,
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(websocket);

  registerAuth(app, ctx);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: (err as { code?: string }).code ?? 'error', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  for (const mod of [
    systemRoutes,
    authRoutes,
    passkeyRoutes,
    circleRoutes,
    locationRoutes,
    tripRoutes,
    placeRoutes,
    notificationRoutes,
    deviceRoutes,
    accountRoutes,
    adminRoutes,
    realtimeRoutes,
  ]) {
    await app.register(async (scope) => mod(scope, ctx));
  }

  // Serve the built web app (single-container deployment).
  const webDist = resolve(config.WEB_DIST ?? join(process.cwd(), '../web/dist'));
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders(res, path) {
        if (path.includes(`${join('assets', '')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: 'not_found', message: 'Not found' });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'Not found' }));
  }

  app.addHook('onClose', async () => {
    if (!opts.sql) await sql.end({ timeout: 5 });
  });

  return { app, ctx };
}
