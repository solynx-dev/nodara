import { formatDistance, formatDuration, formatSpeed, type UnitSystem } from '@nodara/shared';
import type { Ctx } from '../context.js';
import { historyAccess, tripsVisibleSql } from './access.js';
import { MODE_SQL } from './serialize.js';
import { placeAt } from './trips.js';

/** Only drives that just ended are announced (not a backlog being caught up, nor a rebuild). */
const FRESH_MS = 30 * 60_000;
const MIN_DISTANCE_M = 500;
const MIN_DURATION_SEC = 120;

/**
 * "Ava drove to Work · 24 km · 30 min · top 120 km/h": tells circle-mates who
 * turned on "Finished drives" that someone finished a drive. Off by default for
 * everyone. Follows the same rules as seeing their trips: only circles where
 * they share and trips are visible, nothing from a bubble, nothing while they've
 * paused sharing, and not for walks or passenger rides. The place is named the
 * way the person getting it knows it (their circles' places and their own).
 */
export async function notifyDriveFinished(ctx: Ctx, tripId: string) {
  const { sql } = ctx;
  const [t] = await sql<
    { id: string; user_id: string; ended_at: Date | null; distance_m: number; duration_sec: number; max_speed: number | null; end_lat: number; end_lon: number; end_label: string | null; role: string | null; mode: string; name: string; paused: boolean; is_demo: boolean }[]
  >`
    SELECT t.id, t.user_id, t.ended_at, t.distance_m, t.duration_sec, t.max_speed, t.end_lat, t.end_lon, t.end_label, t.role,
           ${sql.unsafe(MODE_SQL)} AS mode, u.display_name AS name, u.sharing_paused AS paused, u.is_demo
    FROM trips t JOIN users u ON u.id = t.user_id
    WHERE t.id = ${tripId} AND t.status = 'completed'`;
  if (!t || !t.ended_at || t.paused || t.is_demo) return 0;
  if (t.mode !== 'driving' || t.role === 'passenger') return 0;
  if (Date.now() - t.ended_at.getTime() > FRESH_MS) return 0;
  if (t.distance_m < MIN_DISTANCE_M || t.duration_sec < MIN_DURATION_SEC) return 0;

  // People in circles where the driver shares and trips are visible, who haven't muted that circle.
  const candidates = await sql<{ user_id: string; units: UnitSystem | null }[]>`
    SELECT DISTINCT v.user_id, v_u.preferences ->> 'units' AS units
    FROM circle_members d
    JOIN circle_members v ON v.circle_id = d.circle_id AND v.user_id <> d.user_id
    JOIN circles c ON c.id = d.circle_id
    JOIN users v_u ON v_u.id = v.user_id
    WHERE d.user_id = ${t.user_id} AND d.sharing
      AND COALESCE((c.settings ->> 'tripsVisible')::boolean, true)
      AND NOT COALESCE((v.notify_settings ->> 'muted')::boolean, false)
      AND COALESCE((v_u.preferences -> 'notifications' -> 'drives' ->> 'inApp')::boolean, false)`;

  let sent = 0;
  let geocoded: string | null | undefined;
  for (const c of candidates) {
    const access = await historyAccess(sql, c.user_id, t.user_id, 'trips');
    if (!access) continue;
    const [visible] = await sql`SELECT 1 FROM trips WHERE id = ${t.id} ${tripsVisibleSql(sql, access)}`;
    if (!visible) continue;

    const units: UnitSystem = c.units === 'imperial' ? 'imperial' : 'metric';
    const place = await placeAt(ctx, c.user_id, t.end_lat, t.end_lon);
    if (!place && geocoded === undefined) geocoded = t.end_label ?? (await ctx.geocoder.reverse(t.end_lat, t.end_lon).catch(() => null));
    const facts = [formatDistance(t.distance_m, units), formatDuration(t.duration_sec)];
    if (t.max_speed != null && t.max_speed > 1) facts.push(`top ${formatSpeed(t.max_speed, units)}`);
    const where = place ? `Ended at ${place.name}.` : geocoded ? `Ended near ${geocoded}.` : '';

    const n = await ctx.notify.notify({
      userId: c.user_id,
      type: 'drive_finished',
      title: place ? `${t.name} drove to ${place.name}` : `${t.name} finished a drive`,
      body: `${facts.join(' · ')}${where ? `. ${where}` : ''}`,
      data: { userId: t.user_id, tripId: t.id, placeId: place?.id ?? null, url: `/trips/${t.id}` },
      url: `/trips/${t.id}`,
      dedupeKey: `drive:${t.user_id}:${t.ended_at.toISOString()}`,
      dedupeWindowSec: 86_400,
    });
    if (n) sent++;
  }
  return sent;
}
