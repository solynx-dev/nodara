import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from './db/index.js';
import type { Config } from './config.js';
import type { RealtimeHub } from './services/realtime.js';
import type { SettingsService } from './services/settings.js';
import type { NotificationService } from './services/notify.js';
import type { PushService } from './services/push.js';
import type { Mailer } from './services/mailer.js';
import type { Geocoder } from './services/geocoder.js';

/** Shared services handed to every module. */
export interface Ctx {
  sql: Sql;
  config: Config;
  log: FastifyBaseLogger;
  hub: RealtimeHub;
  settings: SettingsService;
  notify: NotificationService;
  push: PushService;
  mailer: Mailer;
  geocoder: Geocoder;
}
