import type { Ctx } from '../context.js';
import { canSeeLive } from './access.js';

/** At most one refresh per person every this many seconds, whoever asks. */
export const REFRESH_EVERY_SEC = 10;
/** Phones quiet for this long get woken automatically… */
const AUTO_AFTER_MIN = 60;

export type RefreshResult =
  | { requested: true; devices: number }
  | { requested: false; reason: 'not_visible' | 'paused' | 'no_app' | 'too_soon'; retryAfterSec?: number };

/**
 * Ask someone's phone for a fresh location. Silent on both sides: no
 * notification, nothing in their app, nothing in the audit log. Rate limited
 * per person (not per asker) so a family can't drain one phone's battery.
 */
export async function requestRefresh(ctx: Ctx, viewerId: string, targetId: string): Promise<RefreshResult> {
  const { sql } = ctx;
  const [u] = await sql<{ sharing_paused: boolean; shared: boolean }[]>`
    SELECT u.sharing_paused,
           EXISTS (SELECT 1 FROM circle_members a JOIN circle_members b ON b.circle_id = a.circle_id
                   WHERE a.user_id = ${viewerId} AND b.user_id = u.id) AS shared
    FROM users u WHERE u.id = ${targetId}`;
  // Paused means paused: a refresh never overrides it. (Their circles already know they paused.)
  if (u?.sharing_paused && (u.shared || viewerId === targetId)) return { requested: false, reason: 'paused' };
  if (!u || (viewerId !== targetId && !(await canSeeLive(sql, viewerId, targetId)))) return { requested: false, reason: 'not_visible' };
  const devices = await sql<{ id: string; wake_token: string }[]>`
    UPDATE devices SET wake_requested_at = now()
    WHERE user_id = ${targetId} AND wake_token IS NOT NULL AND revoked_at IS NULL
      AND (wake_requested_at IS NULL OR wake_requested_at < now() - make_interval(secs => ${REFRESH_EVERY_SEC}))
    RETURNING id, wake_token`;
  if (!devices.length) {
    const [last] = await sql<{ at: Date | null }[]>`
      SELECT max(wake_requested_at) AS at FROM devices WHERE user_id = ${targetId} AND wake_token IS NOT NULL AND revoked_at IS NULL`;
    if (!last?.at) return { requested: false, reason: 'no_app' };
    return { requested: false, reason: 'too_soon', retryAfterSec: Math.max(1, Math.ceil(REFRESH_EVERY_SEC - (Date.now() - last.at.getTime()) / 1000)) };
  }
  await ctx.push.sendWake(devices);
  return { requested: true, devices: devices.length };
}

/**
 * Background job: phones that haven't sent a location in an hour (iOS can go
 * quiet when parked, in Low Power Mode, or after a restart) get a silent
 * wake-up, at most once an hour each. Paused people are left alone.
 */
export async function wakeQuietPhones(ctx: Ctx) {
  const devices = await ctx.sql<{ id: string; wake_token: string }[]>`
    UPDATE devices d SET wake_requested_at = now()
    FROM users u
    WHERE u.id = d.user_id AND d.wake_token IS NOT NULL AND d.revoked_at IS NULL
      AND NOT u.sharing_paused AND u.disabled_at IS NULL AND NOT u.is_demo
      AND EXISTS (SELECT 1 FROM circle_members m WHERE m.user_id = u.id AND m.sharing)
      AND (d.last_location_at IS NULL OR d.last_location_at < now() - make_interval(mins => ${AUTO_AFTER_MIN}))
      AND (d.wake_requested_at IS NULL OR d.wake_requested_at < now() - make_interval(mins => ${AUTO_AFTER_MIN}))
    RETURNING d.id, d.wake_token`;
  if (devices.length) await ctx.push.sendWake(devices);
  return devices.length;
}
