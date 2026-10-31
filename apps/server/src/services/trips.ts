import type { Ctx } from '../context.js';
import {
  DEFAULT_TRIP_CONFIG,
  segmentTrips,
  type DetectedTrip,
  type DetectorState,
  type TPoint,
  type TripConfig,
} from './trip-detect.js';
import { haversine } from '@nodara/shared';

const BATCH = 20_000;
const chains = new Map<string, Promise<unknown>>();

/** Run `fn` serially per key so concurrent ingests never race on trip state. */
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return next;
}

export async function tripConfig(ctx: Ctx): Promise<TripConfig> {
  const s = (await ctx.settings.get()).trip;
  return { ...DEFAULT_TRIP_CONFIG, departRadiusM: s.departRadiusM, endAfterSec: s.endAfterSec, minDistanceM: s.minDistanceM };
}

interface StoredState {
  mode: 'stationary' | 'moving';
  anchor: TPoint;
  last: TPoint;
}

/**
 * Incrementally segment newly ingested fixes for one device into trips.
 * Completed trips are persisted; an in-progress trip is kept as a single row
 * with status 'in_progress' that is replaced on every run.
 */
export function processDeviceTrips(ctx: Ctx, deviceId: string, now = Date.now()) {
  return serial(deviceId, () => runDevice(ctx, deviceId, now));
}

async function runDevice(ctx: Ctx, deviceId: string, now: number) {
  const { sql } = ctx;
  const [device] = await sql<{ user_id: string; trip_state: StoredState | null }[]>`
    SELECT user_id, trip_state FROM devices WHERE id = ${deviceId}`;
  if (!device) return { completed: 0, open: false };
  const cfg = await tripConfig(ctx);
  let state: DetectorState | null = device.trip_state;
  let completedCount = 0;
  let open: DetectedTrip | null = null;

  for (;;) {
    const after = state ? new Date(state.last.t) : new Date(0);
    const rows = await sql<{ id: number; recorded_at: Date; lat: number; lon: number; accuracy: number | null; speed: number | null }[]>`
      SELECT id, recorded_at, lat, lon, accuracy, speed FROM locations
      WHERE device_id = ${deviceId} AND recorded_at > ${after}
      ORDER BY recorded_at LIMIT ${BATCH}`;
    const points: TPoint[] = rows.map((r) => ({
      id: r.id,
      t: r.recorded_at.getTime(),
      lat: r.lat,
      lon: r.lon,
      accuracy: r.accuracy,
      speed: r.speed,
    }));
    if (points.length === 0 && state?.mode !== 'moving') break;
    const full = points.length === BATCH;
    // While catching up on a large backlog, use the batch's last fix as "now".
    const effectiveNow = full ? points[points.length - 1]!.t : now;
    const res = segmentTrips(points, cfg, effectiveNow, state);

    for (const trip of res.completed) {
      await saveTrip(ctx, device.user_id, deviceId, trip, 'completed');
      completedCount++;
    }
    open = res.open;
    if (open) await saveTrip(ctx, device.user_id, deviceId, open, 'in_progress');
    else await sql`DELETE FROM trips WHERE device_id = ${deviceId} AND status = 'in_progress'`;

    state = res.state;
    await sql`UPDATE devices SET trip_state = ${state ? sql.json(state as never) : null} WHERE id = ${deviceId}`;
    if (!full) break;
  }
  return { completed: completedCount, open: Boolean(open) };
}

/** Delete and recompute all trips for a user's devices (e.g. after importing history). */
export async function rebuildTrips(ctx: Ctx, userId: string) {
  const devices = await ctx.sql<{ id: string }[]>`SELECT id FROM devices WHERE user_id = ${userId}`;
  let completed = 0;
  for (const d of devices) {
    await serial(d.id, async () => {
      await ctx.sql`DELETE FROM trips WHERE device_id = ${d.id}`;
      await ctx.sql`UPDATE devices SET trip_state = NULL WHERE id = ${d.id}`;
    });
    completed += (await processDeviceTrips(ctx, d.id)).completed;
  }
  return completed;
}

async function placeAt(ctx: Ctx, userId: string, lat: number, lon: number) {
  const rows = await ctx.sql<{ id: string; name: string }[]>`
    SELECT p.id, p.name FROM places p
    WHERE (p.owner_id = ${userId} AND p.circle_id IS NULL
           OR p.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = ${userId}))
      AND ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, p.radius_m)
    ORDER BY ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
    LIMIT 1`;
  return rows[0] ?? null;
}

async function saveTrip(ctx: Ctx, userId: string, deviceId: string, trip: DetectedTrip, status: 'completed' | 'in_progress') {
  const { sql } = ctx;
  const first = trip.points[0]!;
  const last = trip.points[trip.points.length - 1]!;
  // Drop consecutive near-duplicates to keep the stored route compact.
  const route: TPoint[] = [];
  for (const p of trip.points) {
    const prev = route[route.length - 1];
    if (!prev || haversine(prev.lat, prev.lon, p.lat, p.lon) > 3) route.push(p);
  }
  if (route.length === 1) route.push(last);
  const wkt = `LINESTRING(${route.map((p) => `${p.lon} ${p.lat}`).join(',')})`;
  const [startPlace, endPlace] = await Promise.all([
    placeAt(ctx, userId, first.lat, first.lon),
    status === 'completed' ? placeAt(ctx, userId, last.lat, last.lon) : Promise.resolve(null),
  ]);

  const [row] = await sql.begin(async (tx) => {
    await tx`DELETE FROM trips WHERE device_id = ${deviceId} AND status = 'in_progress'`;
    if (status === 'completed') {
      // Idempotency: never store the same trip twice.
      await tx`DELETE FROM trips WHERE device_id = ${deviceId} AND started_at = ${new Date(trip.startedAt)}`;
    }
    return tx<{ id: string }[]>`
      INSERT INTO trips (user_id, device_id, status, started_at, ended_at, duration_sec, moving_sec, distance_m,
        max_speed, avg_moving_speed, avg_speed, start_lat, start_lon, end_lat, end_lon, start_label, end_label,
        start_place_id, end_place_id, route, stops, point_count, low_confidence,
        is_demo)
      VALUES (${userId}, ${deviceId}, ${status}, ${new Date(trip.startedAt)},
        ${status === 'completed' ? new Date(trip.endedAt) : null},
        ${trip.durationSec}, ${trip.movingSec}, ${trip.distanceM}, ${trip.maxSpeed}, ${trip.avgMovingSpeed},
        ${trip.avgSpeed}, ${first.lat}, ${first.lon}, ${last.lat}, ${last.lon},
        ${startPlace?.name ?? null}, ${endPlace?.name ?? null}, ${startPlace?.id ?? null}, ${endPlace?.id ?? null},
        ST_GeogFromText(${wkt}), ${sql.json(trip.stops as never)}, ${trip.points.length}, ${trip.lowConfidence},
        (SELECT is_demo FROM users WHERE id = ${userId}))
      RETURNING id`;
  });

  const viewers = await sql<{ user_id: string }[]>`
    SELECT DISTINCT v.user_id FROM circle_members t JOIN circle_members v ON v.circle_id = t.circle_id
    WHERE t.user_id = ${userId} AND t.sharing`;
  ctx.hub.publish([userId, ...viewers.map((v) => v.user_id)], { type: 'trip', userId, tripId: row!.id, status });

  // Fill in human-readable labels in the background when a geocoder is configured.
  if (status === 'completed' && (!startPlace || !endPlace)) {
    void (async () => {
      const s = startPlace ? null : await ctx.geocoder.reverse(first.lat, first.lon);
      const e = endPlace ? null : await ctx.geocoder.reverse(last.lat, last.lon);
      if (s || e) {
        await sql`UPDATE trips SET start_label = COALESCE(start_label, ${s}), end_label = COALESCE(end_label, ${e})
                  WHERE id = ${row!.id}`;
      }
    })().catch((err) => ctx.log.warn({ err }, 'trip labelling failed'));
  }
}
