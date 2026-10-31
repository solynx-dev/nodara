import { z } from 'zod';
import type { Ctx } from '../context.js';
import { computeSpeed, type SpeedInput } from './speed.js';
import { processDeviceTrips } from './trips.js';
import { evaluateGeofences } from './geofence.js';
import { viewersOf } from './access.js';
import { LOCATION_COLUMNS, serializeLocation, type LocationRow } from './serialize.js';

const num = (min: number, max: number) => z.number().finite().min(min).max(max);

/** Canonical fix accepted by the ingestion API. Speed in m/s, battery in percent. */
export const fixSchema = z.object({
  recordedAt: z.union([z.string().datetime({ offset: true }), z.number().int().positive()]),
  lat: num(-90, 90),
  lon: num(-180, 180),
  accuracy: num(0, 100_000).nullish(),
  altitude: num(-1000, 100_000).nullish(),
  altitudeAccuracy: num(0, 100_000).nullish(),
  speed: num(-1, 1000).nullish(),
  heading: num(-1, 360).nullish(),
  battery: num(0, 100).nullish(),
  charging: z.boolean().nullish(),
  activity: z.string().max(32).nullish(),
});
export type FixInput = z.infer<typeof fixSchema>;

export const MAX_BATCH = 1000;
const MAX_FUTURE_MS = 5 * 60_000;

export interface IngestResult {
  accepted: number;
  rejected: number;
  duplicates: number;
  latest: ReturnType<typeof serializeLocation> | null;
}

function toMs(v: string | number) {
  return typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
}

/**
 * The single entry point for location data, used by the PWA, the native-app
 * API and the OwnTracks/Overland adapters.
 *
 * Pipeline: validate → order → filter speed → batch insert (deduplicated) →
 * update latest → broadcast → geofences → low battery → trip detection.
 */
export async function ingestFixes(
  ctx: Ctx,
  userId: string,
  deviceId: string,
  fixes: FixInput[],
  opts: { awaitTrips?: boolean } = {},
): Promise<IngestResult> {
  const { sql } = ctx;
  const now = Date.now();
  let rejected = 0;
  const ordered = fixes
    .map((f) => ({ ...f, t: toMs(f.recordedAt) }))
    .filter((f) => {
      const ok = Number.isFinite(f.t) && f.t <= now + MAX_FUTURE_MS && f.t > Date.UTC(2000, 0, 1);
      if (!ok) rejected++;
      return ok;
    })
    .sort((a, b) => a.t - b.t);

  const [user] = await sql<{ sharing_paused: boolean; is_demo: boolean; display_name: string; preferences: Record<string, unknown> }[]>`
    SELECT sharing_paused, is_demo, display_name, preferences FROM users WHERE id = ${userId}`;
  if (!user || ordered.length === 0) {
    await bumpStats(ctx, 0, rejected + (user ? 0 : ordered.length));
    return { accepted: 0, rejected, duplicates: 0, latest: null };
  }

  // Previous fix from this device, for derived speeds and battery transitions.
  const [prevRow] = await sql<{ recorded_at: Date; lat: number; lon: number; accuracy: number | null; speed: number | null; battery: number | null }[]>`
    SELECT recorded_at, lat, lon, accuracy, speed, battery FROM locations
    WHERE device_id = ${deviceId} AND recorded_at < ${new Date(ordered[0]!.t)}
    ORDER BY recorded_at DESC LIMIT 1`;
  let prev: SpeedInput | null = prevRow
    ? { t: prevRow.recorded_at.getTime(), lat: prevRow.lat, lon: prevRow.lon, accuracy: prevRow.accuracy, speed: prevRow.speed }
    : null;

  const rows = ordered.map((f) => {
    const cur: SpeedInput = { t: f.t, lat: f.lat, lon: f.lon, accuracy: f.accuracy ?? null, speed: f.speed != null && f.speed >= 0 ? f.speed : null };
    const sp = computeSpeed(prev, cur);
    if ((f.accuracy ?? 0) <= 100) prev = cur;
    const battery = f.battery == null ? null : Math.round(f.battery);
    return {
      user_id: userId,
      device_id: deviceId,
      recorded_at: new Date(f.t),
      lat: f.lat,
      lon: f.lon,
      accuracy: f.accuracy ?? null,
      altitude: f.altitude ?? null,
      altitude_accuracy: f.altitudeAccuracy ?? null,
      speed: sp.speed,
      raw_speed: f.speed != null && f.speed >= 0 ? f.speed : null,
      speed_source: sp.source,
      heading: f.heading != null && f.heading >= 0 ? f.heading : null,
      battery,
      charging: f.charging ?? null,
      activity: f.activity ?? null,
      shared: !user.sharing_paused,
      is_demo: user.is_demo,
    };
  });

  const inserted = await sql<LocationRow[]>`
    INSERT INTO locations ${sql(rows)}
    ON CONFLICT (user_id, device_id, recorded_at) DO NOTHING
    RETURNING ${sql(LOCATION_COLUMNS as unknown as string[])}`;
  const duplicates = rows.length - inserted.length;
  await bumpStats(ctx, inserted.length, rejected);

  await sql`UPDATE devices SET last_seen_at = now(),
              last_location_at = GREATEST(last_location_at, ${rows[rows.length - 1]!.recorded_at})
            WHERE id = ${deviceId}`;
  if (inserted.length === 0) return { accepted: 0, rejected, duplicates, latest: null };

  const newest = inserted.reduce((a, b) => (b.recorded_at > a.recorded_at ? b : a));
  const updated = await sql`
    INSERT INTO latest_locations (user_id, location_id, recorded_at)
    VALUES (${userId}, ${newest.id}, ${newest.recorded_at})
    ON CONFLICT (user_id) DO UPDATE SET location_id = EXCLUDED.location_id, recorded_at = EXCLUDED.recorded_at
    WHERE latest_locations.recorded_at < EXCLUDED.recorded_at
    RETURNING user_id`;
  const latest = serializeLocation(newest);

  if (updated.length > 0) {
    const viewers = user.sharing_paused ? [userId] : await viewersOf(sql, userId);
    ctx.hub.publish(viewers, { type: 'location', userId, location: latest });
    await checkLowBattery(ctx, userId, user, prevRow?.battery ?? null, newest);
  }

  if (!user.sharing_paused) {
    await evaluateGeofences(
      ctx,
      userId,
      inserted
        .sort((a, b) => a.recorded_at.getTime() - b.recorded_at.getTime())
        .map((r) => ({ t: r.recorded_at, lat: r.lat, lon: r.lon, accuracy: r.accuracy })),
    ).catch((err) => ctx.log.error({ err }, 'geofence evaluation failed'));
  }

  const trips = processDeviceTrips(ctx, deviceId).catch((err) => ctx.log.error({ err }, 'trip processing failed'));
  if (opts.awaitTrips) await trips;

  return { accepted: inserted.length, rejected, duplicates, latest };
}

async function checkLowBattery(
  ctx: Ctx,
  userId: string,
  user: { display_name: string; sharing_paused: boolean; preferences: Record<string, unknown> },
  prevBattery: number | null,
  fix: LocationRow,
) {
  if (fix.battery == null || fix.charging || user.sharing_paused) return;
  const threshold = Number(user.preferences.lowBatteryThreshold ?? 15);
  if (user.preferences.notifyLowBattery === false) return;
  if (fix.battery > threshold || (prevBattery != null && prevBattery <= threshold)) return;
  const viewers = (await viewersOf(ctx.sql, userId)).filter((v) => v !== userId);
  for (const v of viewers) {
    await ctx.notify.notify({
      userId: v,
      type: 'low_battery',
      title: `${user.display_name}'s battery is low`,
      body: `${fix.battery}% remaining — location updates may stop soon.`,
      data: { userId, battery: fix.battery },
      dedupeKey: `lowbat:${userId}`,
      dedupeWindowSec: 6 * 3600,
      url: `/map?member=${userId}`,
    });
  }
}

async function bumpStats(ctx: Ctx, accepted: number, rejected: number) {
  if (!accepted && !rejected) return;
  await ctx.sql`
    INSERT INTO ingest_stats (hour, accepted, rejected) VALUES (date_trunc('hour', now()), ${accepted}, ${rejected})
    ON CONFLICT (hour) DO UPDATE SET accepted = ingest_stats.accepted + EXCLUDED.accepted,
                                     rejected = ingest_stats.rejected + EXCLUDED.rejected`;
}

// ---------------------------------------------------------------------------
// Third-party client adapters. These let people use mature native tracking
// apps today — with real background location — before Nodara's own native
// apps exist.

/** OwnTracks HTTP mode payload (https://owntracks.org/booklet/tech/json/). */
export function fromOwnTracks(body: unknown): FixInput[] {
  const items = Array.isArray(body) ? body : [body];
  const out: FixInput[] = [];
  for (const raw of items) {
    const m = raw as Record<string, unknown>;
    if (m?._type !== 'location' || typeof m.lat !== 'number' || typeof m.lon !== 'number' || typeof m.tst !== 'number') continue;
    out.push({
      recordedAt: m.tst * 1000,
      lat: m.lat,
      lon: m.lon,
      accuracy: typeof m.acc === 'number' ? m.acc : null,
      altitude: typeof m.alt === 'number' ? m.alt : null,
      altitudeAccuracy: typeof m.vac === 'number' ? m.vac : null,
      // OwnTracks reports velocity in km/h.
      speed: typeof m.vel === 'number' && m.vel >= 0 ? m.vel / 3.6 : null,
      heading: typeof m.cog === 'number' ? m.cog : null,
      battery: typeof m.batt === 'number' ? m.batt : null,
      // bs: 0 unknown, 1 unplugged, 2 charging, 3 full
      charging: typeof m.bs === 'number' && m.bs > 0 ? m.bs >= 2 : null,
      activity: null,
    });
  }
  return out;
}

/** Overland (iOS) GeoJSON batch payload (https://github.com/aaronpk/Overland-iOS). */
export function fromOverland(body: unknown): FixInput[] {
  const locs = (body as { locations?: unknown[] })?.locations;
  if (!Array.isArray(locs)) return [];
  const out: FixInput[] = [];
  for (const raw of locs) {
    const f = raw as { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> };
    const c = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!c || c.length < 2 || typeof p.timestamp !== 'string') continue;
    const speed = typeof p.speed === 'number' && p.speed >= 0 ? p.speed : null;
    out.push({
      recordedAt: p.timestamp,
      lat: c[1]!,
      lon: c[0]!,
      accuracy: typeof p.horizontal_accuracy === 'number' ? p.horizontal_accuracy : null,
      altitude: typeof p.altitude === 'number' ? p.altitude : null,
      altitudeAccuracy: typeof p.vertical_accuracy === 'number' ? p.vertical_accuracy : null,
      speed,
      heading: typeof p.course === 'number' && p.course >= 0 ? p.course : null,
      battery: typeof p.battery_level === 'number' ? p.battery_level * 100 : null,
      charging: typeof p.battery_state === 'string' ? ['charging', 'full'].includes(p.battery_state) : null,
      activity: Array.isArray(p.motion) && typeof p.motion[0] === 'string' ? p.motion[0] : null,
    });
  }
  return out;
}
