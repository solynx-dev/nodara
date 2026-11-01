import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PublicUser } from '@nodara/shared';
import type { Ctx } from '../context.js';
import { requireUser } from '../auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { circleMatesOf, historyAccess, isCircleMember, type HistoryAccess } from '../services/access.js';
import { COUNTED, DRIVING_KINDS, recordPhoneUse, type DrivingKind } from '../services/driving.js';
import { MODE_SQL } from '../services/serialize.js';
import { ingestIdentity } from './locations.js';

const uuid = z.string().uuid();
type Counts = Record<DrivingKind, number>;
const zero = (): Counts => ({ speeding: 0, phone_use: 0, rapid_accel: 0, hard_brake: 0 });

export interface DrivingEventOut {
  id: string;
  kind: DrivingKind;
  startedAt: string;
  endedAt: string;
  lat: number;
  lon: number;
  speed: number | null;
  value: number | null;
  tripId: string | null;
}

/** SQL fragment: only events the viewer may see (same rules as trips). */
const visible = (ctx: Ctx, access: Exclude<HistoryAccess, null>) => (access.own ? ctx.sql`` : ctx.sql`AND e.shared AND e.started_at >= ${access.since}`);

export async function drivingEvents(ctx: Ctx, userId: string, access: Exclude<HistoryAccess, null>, from: Date, to: Date, limit = 500): Promise<DrivingEventOut[]> {
  const rows = await ctx.sql<{ id: number; kind: DrivingKind; started_at: Date; ended_at: Date; lat: number; lon: number; speed: number | null; value: number | null; trip_id: string | null }[]>`
    SELECT e.id, e.kind, e.started_at, e.ended_at, e.lat, e.lon, e.speed, e.value, t.id AS trip_id
    FROM driving_events e
    LEFT JOIN LATERAL (
      SELECT id FROM trips WHERE user_id = e.user_id AND started_at <= e.started_at AND COALESCE(ended_at, now()) >= e.started_at
      ORDER BY started_at DESC LIMIT 1
    ) t ON true
    WHERE e.user_id = ${userId} AND e.started_at >= ${from} AND e.started_at < ${to} AND ${ctx.sql.unsafe(COUNTED)}
      ${visible(ctx, access)}
    ORDER BY e.started_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at.toISOString(),
    lat: r.lat,
    lon: r.lon,
    speed: r.speed,
    value: r.value,
    tripId: r.trip_id,
  }));
}

export default async function drivingRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  /**
   * Phone unlocks from the iOS app (device token or session). Only unlocks
   * that happened while the person was moving become "phone use" events.
   */
  app.post('/api/driving/phone-use', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(
      z.object({ deviceId: uuid.nullish(), times: z.array(z.union([z.string().datetime({ offset: true }), z.number().positive()])).max(500) }),
      req.body,
    );
    const id = await ingestIdentity(ctx, req, body.deviceId);
    const now = Date.now();
    const times = body.times
      .map((t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t)))
      .filter((t) => Number.isFinite(t) && t <= now + 60_000 && t >= now - 14 * 86_400_000);
    return { recorded: await recordPhoneUse(ctx, id.userId, id.deviceId, times) };
  });

  app.get('/api/driving/events', async (req) => {
    const a = requireUser(req);
    const q = parse(
      z.object({
        userId: uuid.optional(),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        limit: z.coerce.number().int().min(1).max(1000).default(500),
      }),
      req.query,
    );
    const target = q.userId ?? a.userId;
    const access = await historyAccess(sql, a.userId, target, 'trips');
    if (!access) throw notFound('No driving data available for this person');
    return drivingEvents(ctx, target, access, new Date(q.from), new Date(q.to), q.limit);
  });

  /**
   * Weekly driving report (Monday to Sunday in the viewer's time zone) for a
   * circle, or for everyone the viewer shares a circle with.
   */
  app.get('/api/driving/report', async (req) => {
    const a = requireUser(req);
    const q = parse(
      z.object({
        circleId: uuid.optional(),
        offset: z.coerce.number().int().min(0).max(104).default(0),
        tz: z.string().max(64).default('UTC'),
      }),
      req.query,
    );
    const valid = await sql`SELECT 1 FROM pg_timezone_names WHERE name = ${q.tz}`;
    if (!valid.length) throw badRequest('Unknown time zone');

    let ids: string[];
    if (q.circleId) {
      if (!(await isCircleMember(sql, q.circleId, a.userId))) throw notFound('Circle not found');
      ids = (await sql<{ user_id: string }[]>`SELECT user_id FROM circle_members WHERE circle_id = ${q.circleId}`).map((r) => r.user_id);
    } else {
      ids = [a.userId, ...(await circleMatesOf(sql, a.userId))];
    }

    const [range] = await sql<{ start: Date; end: Date; prev_start: Date }[]>`
      WITH b AS (SELECT date_trunc('week', now() AT TIME ZONE ${q.tz}) - make_interval(weeks => ${q.offset}) AS s)
      SELECT (s AT TIME ZONE ${q.tz}) AS start,
             ((s + interval '1 week') AT TIME ZONE ${q.tz}) AS "end",
             ((s - interval '1 week') AT TIME ZONE ${q.tz}) AS prev_start
      FROM b`;
    const { start, end, prev_start } = range!;

    const users = await sql<{ id: string; display_name: string; avatar_color: string; avatar_url: string | null }[]>`
      SELECT id, display_name, avatar_color, avatar_url FROM users WHERE id = ANY(${ids}::uuid[]) AND disabled_at IS NULL
      ORDER BY (id = ${a.userId}) DESC, display_name`;

    const people = [];
    for (const u of users) {
      const user: PublicUser = { id: u.id, displayName: u.display_name, avatarColor: u.avatar_color, avatarUrl: u.avatar_url };
      const access = await historyAccess(sql, a.userId, u.id, 'trips');
      if (!access) {
        people.push({ user, hidden: true as const });
        continue;
      }
      const since = access.own ? null : access.since;
      const [t] = await sql<{ drives: number; distance: number; duration: number; top: number | null }[]>`
        SELECT count(*)::int AS drives, COALESCE(sum(distance_m), 0)::float AS distance,
               COALESCE(sum(duration_sec), 0)::int AS duration, max(max_speed) AS top
        FROM trips
        WHERE user_id = ${u.id} AND status = 'completed' AND ${sql.unsafe(MODE_SQL)} = 'driving'
          AND started_at >= ${start} AND started_at < ${end}
          ${since ? sql`AND started_at >= ${since}` : sql``}`;
      const counts = await sql<{ kind: DrivingKind; current: number; previous: number }[]>`
        SELECT kind,
               count(*) FILTER (WHERE started_at >= ${start})::int AS current,
               count(*) FILTER (WHERE started_at < ${start})::int AS previous
        FROM driving_events e
        WHERE user_id = ${u.id} AND started_at >= ${prev_start} AND started_at < ${end} AND ${sql.unsafe(COUNTED)}
          ${visible(ctx, access)}
        GROUP BY kind`;
      const events = zero();
      const previous = zero();
      for (const c of counts) {
        events[c.kind] = c.current;
        previous[c.kind] = c.previous;
      }
      people.push({ user, hidden: false as const, drives: t!.drives, distanceM: t!.distance, durationSec: t!.duration, topSpeed: t!.top, events, previous });
    }

    const shown = people.filter((p) => !p.hidden);
    const sum = (key: 'events' | 'previous') => {
      const out = zero();
      for (const p of shown) for (const k of DRIVING_KINDS) out[k] += p[key][k];
      return out;
    };
    const fastest = shown.reduce<(typeof shown)[number] | null>((m, p) => ((p.topSpeed ?? 0) > (m?.topSpeed ?? 0) ? p : m), null);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      offset: q.offset,
      speedingKmh: ctx.config.DRIVING_SPEEDING_KMH,
      totals: {
        drives: shown.reduce((s, p) => s + p.drives, 0),
        distanceM: shown.reduce((s, p) => s + p.distanceM, 0),
        durationSec: shown.reduce((s, p) => s + p.durationSec, 0),
        topSpeed: fastest?.topSpeed ? { speed: fastest.topSpeed, userId: fastest.user.id } : null,
        events: sum('events'),
        previous: sum('previous'),
      },
      people,
    };
  });
}
