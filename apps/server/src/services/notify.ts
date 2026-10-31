import type { AppNotification } from '@nodara/shared';
import type { Sql } from '../db/index.js';
import type { RealtimeHub } from './realtime.js';
import type { PushService } from './push.js';

export type NotificationType =
  | 'arrival'
  | 'departure'
  | 'invitation'
  | 'member_joined'
  | 'sharing_changed'
  | 'low_battery'
  | 'device_offline'
  | 'retention'
  | 'security'
  | 'system';

/** Preference key controlling each notification type (see UserPreferences.notifications). */
const PREF_KEY: Record<NotificationType, string | null> = {
  arrival: 'places',
  departure: 'places',
  invitation: null,
  member_joined: 'circle',
  sharing_changed: 'sharing',
  low_battery: 'lowBattery',
  device_offline: 'deviceOffline',
  retention: null,
  security: null,
  system: null,
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  /** Suppress if an identical key was sent to this user within `dedupeWindowSec`. */
  dedupeKey?: string;
  dedupeWindowSec?: number;
  url?: string;
}

export function serializeNotification(r: {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}): AppNotification {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    data: r.data,
    readAt: r.read_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Creates in-app notifications, pushes them over the realtime socket, and
 * fans out to web push when the user has it enabled. Email / native push can
 * be added as further channels here without touching callers.
 */
export class NotificationService {
  constructor(
    private sql: Sql,
    private hub: RealtimeHub,
    private push: PushService,
  ) {}

  async notify(input: NotifyInput): Promise<AppNotification | null> {
    const [user] = await this.sql<{ preferences: Record<string, unknown>; disabled_at: Date | null }[]>`
      SELECT preferences, disabled_at FROM users WHERE id = ${input.userId}`;
    if (!user || user.disabled_at) return null;
    const prefs = (user.preferences.notifications ?? {}) as Record<string, { inApp?: boolean; push?: boolean }>;
    const key = PREF_KEY[input.type];
    const pref = key ? prefs[key] : undefined;
    if (pref?.inApp === false) return null;

    if (input.dedupeKey) {
      const window = input.dedupeWindowSec ?? 3600;
      const dup = await this.sql`
        SELECT 1 FROM notifications
        WHERE user_id = ${input.userId} AND dedupe_key = ${input.dedupeKey}
          AND created_at > now() - make_interval(secs => ${window})
        LIMIT 1`;
      if (dup.length) return null;
    }

    const [row] = await this.sql<Parameters<typeof serializeNotification>[0][]>`
      INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
      VALUES (${input.userId}, ${input.type}, ${input.title}, ${input.body ?? ''},
              ${this.sql.json((input.data ?? {}) as never)}, ${input.dedupeKey ?? null})
      RETURNING id, type, title, body, data, read_at, created_at`;
    const notification = serializeNotification(row!);
    this.hub.publish([input.userId], { type: 'notification', notification });

    if (pref?.push !== false) {
      void this.push
        .sendToUser(input.userId, {
          title: input.title,
          body: input.body ?? '',
          url: input.url ?? '/notifications',
          tag: input.dedupeKey ?? notification.id,
        })
        .catch(() => {});
    }
    return notification;
  }
}
