import webpush from 'web-push';
import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from '../db/index.js';
import type { Config } from '../config.js';
import type { SettingsService } from './settings.js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Web Push (VAPID). Keys come from the environment or are generated once and
 * stored in system_settings, so push works out of the box with no third-party
 * account. Delivery goes through each browser vendor's push service; payloads
 * are end-to-end encrypted to the subscribing browser.
 */
export class PushService {
  publicKey: string | null = null;
  private ready = false;

  constructor(
    private sql: Sql,
    private config: Config,
    private settings: SettingsService,
    private log: FastifyBaseLogger,
  ) {}

  async init() {
    let pub = this.config.VAPID_PUBLIC_KEY;
    let priv = this.config.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      const stored = await this.settings.getKey<{ publicKey: string; privateKey: string }>('vapid');
      if (stored) {
        pub = stored.publicKey;
        priv = stored.privateKey;
      } else {
        const keys = webpush.generateVAPIDKeys();
        await this.settings.setKey('vapid', keys);
        pub = keys.publicKey;
        priv = keys.privateKey;
        this.log.info('Generated VAPID keys for web push');
      }
    }
    webpush.setVapidDetails(this.config.VAPID_SUBJECT, pub, priv);
    this.publicKey = pub;
    this.ready = true;
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    const [web, native] = await Promise.all([this.sendWebPush(userId, payload), this.sendExpoPush(userId, payload)]);
    return web + native;
  }

  /**
   * Native apps: an app published on the App Store can only be pushed through
   * the publisher's APNs credentials, so self-hosted servers relay through
   * Expo's push service. The message contains only the notification text.
   */
  private async sendExpoPush(userId: string, payload: PushPayload): Promise<number> {
    if (!this.config.EXPO_PUSH_ENABLED) return 0;
    const devices = await this.sql<{ id: string; expo_push_token: string }[]>`
      SELECT id, expo_push_token FROM devices
      WHERE user_id = ${userId} AND expo_push_token IS NOT NULL AND revoked_at IS NULL`;
    if (!devices.length) return 0;
    try {
      const res = await fetch(this.config.EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          devices.map((d) => ({
            to: d.expo_push_token,
            title: payload.title,
            body: payload.body,
            sound: 'default',
            data: { url: payload.url ?? '/' },
            ...(payload.tag ? { threadId: payload.tag.split(':')[0] } : {}),
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      let sent = 0;
      for (const [i, ticket] of (json?.data ?? []).entries()) {
        if (ticket.status === 'ok') sent++;
        else if (ticket.details?.error === 'DeviceNotRegistered') {
          await this.sql`UPDATE devices SET expo_push_token = NULL WHERE id = ${devices[i]!.id}`;
        }
      }
      return sent;
    } catch (err) {
      this.log.warn({ err }, 'expo push failed');
      return 0;
    }
  }

  private async sendWebPush(userId: string, payload: PushPayload): Promise<number> {
    if (!this.ready) return 0;
    const devices = await this.sql<{ id: string; push_subscription: webpush.PushSubscription }[]>`
      SELECT id, push_subscription FROM devices
      WHERE user_id = ${userId} AND push_subscription IS NOT NULL AND revoked_at IS NULL`;
    let sent = 0;
    await Promise.all(
      devices.map(async (d) => {
        try {
          await webpush.sendNotification(d.push_subscription, JSON.stringify(payload), { TTL: 3600 });
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Subscription expired or was revoked by the browser.
            await this.sql`UPDATE devices SET push_subscription = NULL WHERE id = ${d.id}`;
          } else {
            this.log.warn({ err, deviceId: d.id }, 'web push failed');
          }
        }
      }),
    );
    return sent;
  }
}
