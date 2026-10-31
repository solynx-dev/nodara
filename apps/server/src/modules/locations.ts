import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { requireUser, resolveDeviceToken, type AuthInfo } from '../auth.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { fixSchema, fromOverland, fromOwnTracks, ingestFixes, MAX_BATCH } from '../services/ingest.js';
import { historyAccess, type HistoryAccess } from '../services/access.js';
import { LOCATION_COLUMNS, MODE_SQL, serializeLocation, serializeTrip, TRIP_COLUMNS, type LocationRow, type TripRow } from '../services/serialize.js';

const INGEST_RATE = { max: 240, timeWindow: '1 minute' };
const uuid = z.string().uuid();

/** Resolve (user, device) for ingestion from a session + deviceId, or a device token. */
async function ingestIdentity(ctx: Ctx, req: FastifyRequest, deviceId?: string | null): Promise<{ userId: string; deviceId: string }> {
  const a = req.auth;
  if (a?.via === 'device' && a.deviceId) return { userId: a.userId, deviceId: a.deviceId };
  const user = requireUser(req);
  if (!deviceId) throw badRequest('deviceId is required');
  const [d] = await ctx.sql<{ id: string }[]>`
    SELECT id FROM devices WHERE id = ${deviceId} AND user_id = ${user.userId} AND revoked_at IS NULL`;
  if (!d) throw notFound('Device not found');
  return { userId: user.userId, deviceId: d.id };
}

/** Third-party apps authenticate with HTTP Basic (any username, device token as password) or ?token=. */
async function thirdPartyIdentity(ctx: Ctx, req: FastifyRequest): Promise<AuthInfo> {
  if (req.auth?.via === 'device') return req.auth;
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    token = decoded.slice(decoded.indexOf(':') + 1);
  }
  token ??= (req.query as Record<string, string | undefined>).token;
  const auth = token ? await resolveDeviceToken(ctx, token) : null;
  if (!auth) throw unauthorized('A valid device token is required');
  return auth;
}

function rangeQuery(q: unknown, maxDays: number) {
  const r = parse(
    z.object({
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
    }),
    q,
  );
  const from = new Date(r.from);
  const to = new Date(r.to);
  if (to <= from) throw badRequest('`to` must be after `from`');
  if (to.getTime() - from.getTime() > maxDays * 86_400_000) throw badRequest(`Range may not exceed ${maxDays} days`);
  return { from, to };
}

export async function requireHistory(ctx: Ctx, viewerId: string, targetId: string, kind: 'history' | 'trips' = 'history') {
  const access = await historyAccess(ctx.sql, viewerId, targetId, kind);
  if (!access) throw notFound('No history available for this person');
  return access;
}

/** SQL fragment restricting location rows to what the viewer may see. */
export function visibleFilter(ctx: Ctx, access: Exclude<HistoryAccess, null>) {
  if (access.own) return ctx.sql``;
  return ctx.sql`AND shared AND recorded_at >= ${access.since}`;
}

export default async function locationRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  // -- Ingestion ------------------------------------------------------------
  app.post('/api/locations', { config: { rateLimit: INGEST_RATE }, bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const body = parse(
      z.object({ deviceId: uuid.nullish(), locations: z.array(fixSchema).min(1).max(MAX_BATCH) }),
      req.body,
    );
    const id = await ingestIdentity(ctx, req, body.deviceId);
    const r = await ingestFixes(ctx, id.userId, id.deviceId, body.locations);
    // Tell the client what interval to use next (adaptive tracking hint).
    const moving = (r.latest?.speed ?? 0) > 1.5;
    return { ...r, hint: { nextIntervalSec: moving ? 10 : 60 } };
  });

  app.post('/api/ingest/owntracks', { config: { rateLimit: INGEST_RATE } }, async (req) => {
    const auth = await thirdPartyIdentity(ctx, req);
    const fixes = fromOwnTracks(req.body);
    if (fixes.length) await ingestFixes(ctx, auth.userId, auth.deviceId!, fixes);
    // OwnTracks expects a JSON array (of friends' locations / commands) in reply.
    return [];
  });

  app.post('/api/ingest/overland', { config: { rateLimit: INGEST_RATE }, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const auth = await thirdPartyIdentity(ctx, req);
    const fixes = fromOverland(req.body).slice(0, MAX_BATCH);
    if (fixes.length) await ingestFixes(ctx, auth.userId, auth.deviceId!, fixes);
    return { result: 'ok' };
  });

  /**
   * Check in: share a fresh fix right now and tell circle-mates where you are
   * ("Sam checked in at Home"). Optional circleId limits who is notified.
   */
  app.post('/api/checkins', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const a = requireUser(req);
    const body = parse(
      z.object({
        deviceId: uuid,
        circleId: uuid.nullish(),
        message: z.string().trim().max(140).nullish(),
        location: fixSchema,
      }),
      req.body,
    );
    const id = await ingestIdentity(ctx, req, body.deviceId);
    const [me] = await sql<{ display_name: string; sharing_paused: boolean }[]>`SELECT display_name, sharing_paused FROM users WHERE id = ${a.userId}`;
    if (me!.sharing_paused) throw badRequest('Resume location sharing to check in');
    if (body.circleId && !(await sql`SELECT 1 FROM circle_members WHERE circle_id = ${body.circleId} AND user_id = ${a.userId}`).length) {
      throw notFound('Circle not found');
    }
    await ingestFixes(ctx, id.userId, id.deviceId, [body.location]);

    const { lat, lon } = body.location;
    const [place] = await sql<{ name: string }[]>`
      SELECT p.name FROM places p
      WHERE (p.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = ${a.userId}) OR (p.circle_id IS NULL AND p.owner_id = ${a.userId}))
        AND ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, p.radius_m + 75)
      ORDER BY ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) LIMIT 1`;
    const where = place?.name ?? (await ctx.geocoder.reverse(lat, lon));

    // Notify people in circles where this user currently shares their location.
    const recipients = await sql<{ user_id: string }[]>`
      SELECT DISTINCT v.user_id FROM circle_members t
      JOIN circle_members v ON v.circle_id = t.circle_id
      WHERE t.user_id = ${a.userId} AND t.sharing AND v.user_id <> ${a.userId}
        ${body.circleId ? sql`AND t.circle_id = ${body.circleId}` : sql``}
        AND NOT COALESCE((v.notify_settings ->> 'muted')::boolean, false)`;
    for (const r of recipients) {
      await ctx.notify.notify({
        userId: r.user_id,
        type: 'check_in',
        title: `${me!.display_name} checked in${where ? ` at ${where}` : ''}`,
        body: body.message ?? '',
        data: { userId: a.userId, lat, lon },
        url: `/map?member=${a.userId}`,
      });
    }
    return { notified: recipients.length, where };
  });

  // -- History ---------------------------------------------------------------
  app.get<{ Params: { userId: string } }>('/api/history/:userId/points', async (req) => {
    const a = requireUser(req);
    const target = parse(uuid, req.params.userId);
    const { from, to } = rangeQuery(req.query, 31);
    const { maxPoints } = parse(z.object({ maxPoints: z.coerce.number().int().min(10).max(10_000).default(3000) }), req.query);
    const access = await requireHistory(ctx, a.userId, target);
    const vis = visibleFilter(ctx, access);

    const { total, distance } = (await sql<{ total: number; distance: number | null }[]>`
      WITH p AS (
        SELECT geog, accuracy, lag(geog) OVER (ORDER BY recorded_at) AS prev, lag(accuracy) OVER (ORDER BY recorded_at) AS prev_acc
        FROM locations WHERE user_id = ${target} AND recorded_at >= ${from} AND recorded_at < ${to} ${vis}
      )
      SELECT count(*)::int AS total,
             sum(CASE WHEN prev IS NOT NULL AND COALESCE(accuracy, 0) <= 100 AND COALESCE(prev_acc, 0) <= 100
                      AND ST_Distance(geog, prev) > COALESCE(accuracy, 10) + COALESCE(prev_acc, 10)
                 THEN ST_Distance(geog, prev) END) AS distance
      FROM p`)[0]!;

    // Decimate evenly when the range holds more fixes than requested.
    const step = Math.max(1, Math.ceil(total / maxPoints));
    const rows = await sql<LocationRow[]>`
      SELECT ${sql(LOCATION_COLUMNS as unknown as string[])} FROM (
        SELECT *, row_number() OVER (ORDER BY recorded_at) AS rn
        FROM locations WHERE user_id = ${target} AND recorded_at >= ${from} AND recorded_at < ${to} ${vis}
      ) x
      WHERE (rn - 1) % ${step} = 0 OR rn = ${total}
      ORDER BY recorded_at`;
    return {
      points: rows.map(serializeLocation),
      total,
      decimated: step > 1,
      distanceM: distance ?? 0,
      visibleSince: access.own ? null : access.since.toISOString(),
    };
  });

  app.get<{ Params: { userId: string } }>('/api/history/:userId/days', async (req) => {
    const a = requireUser(req);
    const target = parse(uuid, req.params.userId);
    const { from, to } = rangeQuery(req.query, 400);
    const { tz } = parse(z.object({ tz: z.string().max(64).default('UTC') }), req.query);
    const valid = await sql`SELECT 1 FROM pg_timezone_names WHERE name = ${tz}`;
    if (!valid.length) throw badRequest('Unknown time zone');
    const access = await requireHistory(ctx, a.userId, target);
    const vis = visibleFilter(ctx, access);
    const rows = await sql<{ day: string; points: number; distance: number | null; first: Date; last: Date }[]>`
      WITH p AS (
        SELECT recorded_at, geog, accuracy,
               lag(geog) OVER (ORDER BY recorded_at) AS prev, lag(accuracy) OVER (ORDER BY recorded_at) AS prev_acc
        FROM locations WHERE user_id = ${target} AND recorded_at >= ${from} AND recorded_at < ${to} ${vis}
      )
      SELECT to_char((recorded_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
             count(*)::int AS points,
             sum(CASE WHEN prev IS NOT NULL AND COALESCE(accuracy, 0) <= 100 AND COALESCE(prev_acc, 0) <= 100
                      AND ST_Distance(geog, prev) > COALESCE(accuracy, 10) + COALESCE(prev_acc, 10)
                 THEN ST_Distance(geog, prev) END) AS distance,
             min(recorded_at) AS first, max(recorded_at) AS last
      FROM p GROUP BY 1 ORDER BY 1`;
    const tripVis = access.own ? sql`` : sql`AND started_at >= ${access.since}`;
    const trips = await sql<{ day: string; n: number }[]>`
      SELECT to_char((started_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM trips WHERE user_id = ${target} AND status = 'completed' AND started_at >= ${from} AND started_at < ${to} ${tripVis}
      GROUP BY 1`;
    const tripMap = new Map(trips.map((t) => [t.day, t.n]));
    return rows.map((r) => ({
      date: r.day,
      points: r.points,
      distanceM: r.distance ?? 0,
      trips: tripMap.get(r.day) ?? 0,
      firstAt: r.first.toISOString(),
      lastAt: r.last.toISOString(),
    }));
  });

  /**
   * Timeline: alternating stays and trips for a range, which is what people
   * actually want to read ("Home 07:10–08:02 → drove 12 km → Work 08:31–17:05").
   */
  app.get<{ Params: { userId: string } }>('/api/history/:userId/timeline', async (req) => {
    const a = requireUser(req);
    const target = parse(uuid, req.params.userId);
    const { from, to } = rangeQuery(req.query, 31);
    const access = await requireHistory(ctx, a.userId, target);
    const tripAccess = await historyAccess(sql, a.userId, target, 'trips');
    const vis = visibleFilter(ctx, access);

    const trips = tripAccess
      ? await sql<(TripRow & { mode: string })[]>`
          SELECT ${sql(TRIP_COLUMNS as unknown as string[])}, ${sql.unsafe(MODE_SQL)} AS mode FROM trips
          WHERE user_id = ${target} AND started_at < ${to} AND COALESCE(ended_at, now()) > ${from}
            ${tripAccess.own ? sql`` : sql`AND started_at >= ${tripAccess.since}`}
          ORDER BY started_at`
      : [];
    const [bounds] = await sql<{ first: Date | null; last: Date | null }[]>`
      SELECT min(recorded_at) AS first, max(recorded_at) AS last FROM locations
      WHERE user_id = ${target} AND recorded_at >= ${from} AND recorded_at < ${to} ${vis}`;
    if (!bounds?.first || !bounds.last) return { items: [] };

    type Item =
      | { type: 'stay'; startAt: string; endAt: string; lat: number; lon: number; label: string | null; placeId: string | null }
      | { type: 'trip'; trip: ReturnType<typeof serializeTrip> & { mode: string } };
    const items: Item[] = [];

    const stayAt = async (start: Date, end: Date, near: { lat: number; lon: number } | null) => {
      if (end.getTime() - start.getTime() < 60_000) return;
      let pos = near;
      if (!pos) {
        // No trip to anchor on: use the most accurate fix in the window.
        const [p] = await sql<{ lat: number; lon: number }[]>`
          SELECT lat, lon FROM locations WHERE user_id = ${target} AND recorded_at >= ${start} AND recorded_at <= ${end} ${vis}
          ORDER BY accuracy NULLS LAST LIMIT 1`;
        if (!p) return;
        pos = p;
      }
      const [place] = await sql<{ id: string; name: string }[]>`
        SELECT p.id, p.name FROM places p
        WHERE (p.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = ${a.userId})
               OR (p.circle_id IS NULL AND p.owner_id = ${a.userId}))
          AND ST_DWithin(p.geog, ST_SetSRID(ST_MakePoint(${pos.lon}, ${pos.lat}), 4326)::geography, p.radius_m + 75)
        ORDER BY ST_Distance(p.geog, ST_SetSRID(ST_MakePoint(${pos.lon}, ${pos.lat}), 4326)::geography) LIMIT 1`;
      const label = place?.name ?? (await ctx.geocoder.reverse(pos.lat, pos.lon));
      items.push({
        type: 'stay',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        lat: pos.lat,
        lon: pos.lon,
        label,
        placeId: place?.id ?? null,
      });
    };

    let cursor = bounds.first;
    for (const t of trips) {
      if (t.started_at > cursor) await stayAt(cursor, t.started_at, { lat: t.start_lat, lon: t.start_lon });
      items.push({ type: 'trip', trip: { ...serializeTrip(t), mode: t.mode } });
      cursor = t.ended_at ?? new Date();
    }
    const lastTrip = trips[trips.length - 1];
    if (bounds.last > cursor) {
      await stayAt(cursor, bounds.last, lastTrip ? { lat: lastTrip.end_lat, lon: lastTrip.end_lon } : null);
    }
    return { items };
  });

  // Single point inspection (e.g. clicking a dot on the history map).
  app.get<{ Params: { userId: string; id: string } }>('/api/history/:userId/points/:id', async (req) => {
    const a = requireUser(req);
    const target = parse(uuid, req.params.userId);
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const access = await requireHistory(ctx, a.userId, target);
    const [row] = await sql<LocationRow[]>`
      SELECT ${sql(LOCATION_COLUMNS as unknown as string[])} FROM locations
      WHERE id = ${id} AND user_id = ${target} ${visibleFilter(ctx, access)}`;
    if (!row) throw notFound();
    return { ...serializeLocation(row), address: await ctx.geocoder.reverse(row.lat, row.lon) };
  });

  app.delete('/api/history/points', async (req) => {
    const a = requireUser(req);
    if (req.auth?.via === 'device') throw forbidden();
    const { from, to } = rangeQuery(req.query, 36_500);
    const r = await sql`DELETE FROM locations WHERE user_id = ${a.userId} AND recorded_at >= ${from} AND recorded_at < ${to}`;
    await sql`DELETE FROM trips WHERE user_id = ${a.userId} AND started_at >= ${from} AND started_at < ${to}`;
    return { deleted: r.count };
  });
}
