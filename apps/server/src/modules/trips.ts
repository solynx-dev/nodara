import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { requireUser } from '../auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { historyAccess } from '../services/access.js';
import { MODE_SQL, serializeTrip, TRIP_COLUMNS, type TripRow } from '../services/serialize.js';
import { rebuildTrips } from '../services/trips.js';
import { requireHistory } from './locations.js';
import { drivingEvents } from './driving.js';

const uuid = z.string().uuid();



export default async function tripRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  app.get('/api/trips', async (req) => {
    const a = requireUser(req);
    const q = parse(
      z.object({
        userId: uuid.optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        before: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(30),
      }),
      req.query,
    );
    const target = q.userId ?? a.userId;
    const access = await requireHistory(ctx, a.userId, target, 'trips');
    const rows = await sql<(TripRow & { mode: string })[]>`
      SELECT ${sql(TRIP_COLUMNS as unknown as string[])}, ${sql.unsafe(MODE_SQL)} AS mode FROM trips
      WHERE user_id = ${target}
        ${access.own ? sql`` : sql`AND started_at >= ${access.since}`}
        ${q.from ? sql`AND started_at >= ${new Date(q.from)}` : sql``}
        ${q.to ? sql`AND started_at < ${new Date(q.to)}` : sql``}
        ${q.before ? sql`AND started_at < ${new Date(q.before)}` : sql``}
      ORDER BY started_at DESC LIMIT ${q.limit}`;
    return rows.map((r) => ({ ...serializeTrip(r), mode: r.mode }));
  });

  app.get<{ Params: { id: string } }>('/api/trips/:id', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    const [t] = await sql<(TripRow & { device_id: string | null; route_geojson: string | null; moving_sec: number; point_count: number; mode: string })[]>`
      SELECT ${sql(TRIP_COLUMNS as unknown as string[])}, device_id, moving_sec, point_count, ${sql.unsafe(MODE_SQL)} AS mode,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(route::geometry, 0.00002), 6) AS route_geojson
      FROM trips WHERE id = ${id}`;
    if (!t) throw notFound('Trip not found');
    const access = await historyAccess(sql, a.userId, t.user_id, 'trips');
    if (!access || (!access.own && t.started_at < access.since)) throw notFound('Trip not found');

    // Speed profile for the chart, decimated to at most ~400 samples.
    const end = t.ended_at ?? new Date();
    const { n } = (await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM locations
      WHERE user_id = ${t.user_id} AND recorded_at BETWEEN ${t.started_at} AND ${end}
        ${t.device_id ? sql`AND device_id = ${t.device_id}` : sql``}`)[0]!;
    const step = Math.max(1, Math.ceil(n / 400));
    const samples = await sql<{ recorded_at: Date; speed: number | null; speed_source: string; accuracy: number | null; lat: number; lon: number; altitude: number | null }[]>`
      SELECT recorded_at, speed, speed_source, accuracy, lat, lon, altitude FROM (
        SELECT *, row_number() OVER (ORDER BY recorded_at) AS rn FROM locations
        WHERE user_id = ${t.user_id} AND recorded_at BETWEEN ${t.started_at} AND ${end}
          ${t.device_id ? sql`AND device_id = ${t.device_id}` : sql``}
      ) x WHERE (rn - 1) % ${step} = 0 ORDER BY recorded_at`;

    const route = t.route_geojson ? (JSON.parse(t.route_geojson) as { coordinates: [number, number][] }).coordinates : [];
    const events = await drivingEvents(ctx, t.user_id, access, t.started_at, new Date(end.getTime() + 1000));
    return {
      ...serializeTrip(t),
      mode: t.mode,
      movingSec: t.moving_sec,
      pointCount: t.point_count,
      route,
      stops: t.stops,
      events: events.reverse(),
      samples: samples.map((s) => ({
        t: s.recorded_at.toISOString(),
        speed: s.speed,
        source: s.speed_source,
        accuracy: s.accuracy,
        lat: s.lat,
        lon: s.lon,
        altitude: s.altitude,
      })),
    };
  });

  app.delete<{ Params: { id: string } }>('/api/trips/:id', async (req) => {
    const a = requireUser(req);
    const r = await sql`DELETE FROM trips WHERE id = ${parse(uuid, req.params.id)} AND user_id = ${a.userId} AND status = 'completed' RETURNING id`;
    if (!r.length) throw notFound('Trip not found');
    return { ok: true };
  });

  app.post('/api/trips/rebuild', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req) => {
    const a = requireUser(req);
    const completed = await rebuildTrips(ctx, a.userId);
    return { trips: completed };
  });

  // -- Insights ---------------------------------------------------------------
  app.get('/api/insights', async (req) => {
    const a = requireUser(req);
    const q = parse(
      z.object({
        userId: uuid.optional(),
        period: z.enum(['week', 'month', 'year']).default('week'),
        offset: z.coerce.number().int().min(0).max(520).default(0),
        tz: z.string().max(64).default('UTC'),
        mode: z.enum(['all', 'driving']).default('driving'),
      }),
      req.query,
    );
    const valid = await sql`SELECT 1 FROM pg_timezone_names WHERE name = ${q.tz}`;
    if (!valid.length) throw badRequest('Unknown time zone');
    const target = q.userId ?? a.userId;
    const access = await requireHistory(ctx, a.userId, target, 'trips');
    const unit = q.period;
    const bucket = q.period === 'year' ? 'month' : 'day';

    const [range] = await sql<{ start: Date; end: Date; prev_start: Date }[]>`
      WITH b AS (SELECT date_trunc(${unit}, now() AT TIME ZONE ${q.tz}) - make_interval(${sql.unsafe(`${unit}s`)} => ${q.offset}) AS s)
      SELECT (s AT TIME ZONE ${q.tz}) AS start,
             ((s + make_interval(${sql.unsafe(`${unit}s`)} => 1)) AT TIME ZONE ${q.tz}) AS "end",
             ((s - make_interval(${sql.unsafe(`${unit}s`)} => 1)) AT TIME ZONE ${q.tz}) AS prev_start
      FROM b`;
    const { start, end, prev_start } = range!;
    const filter = sql`
      user_id = ${target} AND status = 'completed'
      ${access.own ? sql`` : sql`AND started_at >= ${access.since}`}
      ${q.mode === 'driving' ? sql`AND ${sql.unsafe(MODE_SQL)} = 'driving'` : sql``}`;

    const totals = async (from: Date, to: Date) => {
      const [r] = await sql<{ trips: number; distance: number; duration: number; moving: number; max_speed: number | null }[]>`
        SELECT count(*)::int AS trips, COALESCE(sum(distance_m), 0)::float AS distance,
               COALESCE(sum(duration_sec), 0)::int AS duration, COALESCE(sum(moving_sec), 0)::int AS moving,
               max(max_speed) AS max_speed
        FROM trips WHERE ${filter} AND started_at >= ${from} AND started_at < ${to}`;
      return {
        trips: r!.trips,
        distanceM: r!.distance,
        durationSec: r!.duration,
        avgTripDistanceM: r!.trips ? r!.distance / r!.trips : 0,
        avgSpeed: r!.moving ? r!.distance / r!.moving : null,
        maxSpeed: r!.max_speed,
      };
    };

    const buckets = await sql<{ bucket: string; trips: number; distance: number; duration: number }[]>`
      WITH series AS (
        SELECT generate_series(${start} AT TIME ZONE ${q.tz}, (${end} AT TIME ZONE ${q.tz}) - interval '1 second',
                               ${sql.unsafe(`interval '1 ${bucket}'`)}) AS b
      )
      SELECT to_char(s.b, 'YYYY-MM-DD') AS bucket,
             count(t.id)::int AS trips,
             COALESCE(sum(t.distance_m), 0)::float AS distance,
             COALESCE(sum(t.duration_sec), 0)::int AS duration
      FROM series s
      LEFT JOIN trips t ON ${filter}
        AND date_trunc(${bucket}, t.started_at AT TIME ZONE ${q.tz}) = s.b
      GROUP BY s.b ORDER BY s.b`;

    return {
      period: q.period,
      start: start.toISOString(),
      end: end.toISOString(),
      current: await totals(start, end),
      previous: await totals(prev_start, start),
      buckets: buckets.map((b) => ({ date: b.bucket, trips: b.trips, distanceM: b.distance, durationSec: b.duration })),
      note: 'Travel mode is estimated from average moving speed. Nodara does not infer driving behaviour from GPS alone.',
    };
  });
}
