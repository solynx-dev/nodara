import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { audit, requireUser } from '../auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { isCircleMember } from '../services/access.js';
import { PLACE_COLUMNS, serializePlace, type PlaceRow } from '../services/serialize.js';

const uuid = z.string().uuid();
export const PLACE_ICONS = ['home', 'work', 'school', 'daycare', 'gym', 'heart', 'cart', 'pin', 'star', 'tree', 'coffee', 'hospital'] as const;

const placeBody = z.object({
  name: z.string().trim().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().min(25).max(50_000).default(150),
  icon: z.enum(PLACE_ICONS).default('pin'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FF7A45'),
  circleId: uuid.nullable().default(null),
  address: z.string().trim().max(200).nullish(),
});

/** Places the user can see: their private places and places of their circles. */
const visiblePlaces = (ctx: Ctx, userId: string) => ctx.sql`
  (p.circle_id IS NULL AND p.owner_id = ${userId})
  OR p.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = ${userId})`;

async function loadPlace(ctx: Ctx, userId: string, id: string) {
  const [p] = await ctx.sql<PlaceRow[]>`
    SELECT ${ctx.sql(PLACE_COLUMNS.map((c) => `p.${c}`) as unknown as string[])} FROM places p
    WHERE p.id = ${id} AND (${visiblePlaces(ctx, userId)})`;
  if (!p) throw notFound('Place not found');
  return p;
}

/** Owners of a place, plus admins of its circle, may edit it. */
async function canEdit(ctx: Ctx, userId: string, p: PlaceRow) {
  if (p.owner_id === userId) return true;
  if (!p.circle_id) return false;
  const role = await isCircleMember(ctx.sql, p.circle_id, userId);
  return role === 'owner' || role === 'admin';
}

export default async function placeRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  app.get('/api/places', async (req) => {
    const a = requireUser(req);
    const rows = await sql<(PlaceRow & { inside: string[] | null; alerts: number })[]>`
      SELECT ${sql(PLACE_COLUMNS.map((c) => `p.${c}`) as unknown as string[])},
        (SELECT array_agg(pp.user_id) FROM place_presence pp
           WHERE pp.place_id = p.id AND pp.inside) AS inside,
        (SELECT count(*)::int FROM place_alerts pa WHERE pa.place_id = p.id AND pa.subscriber_id = ${a.userId}) AS alerts
      FROM places p WHERE ${visiblePlaces(ctx, a.userId)} ORDER BY p.name`;
    // Only reveal presence of people the viewer can currently see.
    const visible = new Set(
      (await sql<{ user_id: string }[]>`
        SELECT DISTINCT t.user_id FROM circle_members me JOIN circle_members t ON t.circle_id = me.circle_id
        JOIN users u ON u.id = t.user_id
        WHERE me.user_id = ${a.userId} AND t.sharing AND NOT u.sharing_paused`).map((r) => r.user_id),
    );
    visible.add(a.userId);
    // Same rule as PATCH/DELETE: the creator, or an owner/admin of the place's circle.
    const adminOf = new Set(
      (await sql<{ circle_id: string }[]>`
        SELECT circle_id FROM circle_members WHERE user_id = ${a.userId} AND role IN ('owner', 'admin')`).map((r) => r.circle_id),
    );
    return rows.map((r) => ({
      ...serializePlace(r),
      membersInside: (r.inside ?? []).filter((id) => visible.has(id)),
      alertCount: r.alerts,
      canEdit: r.owner_id === a.userId || (r.circle_id != null && adminOf.has(r.circle_id)),
    }));
  });

  app.post('/api/places', async (req) => {
    const a = requireUser(req);
    const body = parse(placeBody, req.body);
    if (body.circleId && !(await isCircleMember(sql, body.circleId, a.userId))) throw notFound('Circle not found');
    const { n } = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM places WHERE owner_id = ${a.userId}`)[0]!;
    if (n >= 500) throw badRequest('Place limit reached');
    const [row] = await sql<PlaceRow[]>`
      INSERT INTO places (owner_id, circle_id, name, lat, lon, radius_m, icon, color, address)
      VALUES (${a.userId}, ${body.circleId}, ${body.name}, ${body.lat}, ${body.lon}, ${body.radiusM}, ${body.icon},
              ${body.color}, ${body.address ?? null})
      RETURNING ${sql(PLACE_COLUMNS as unknown as string[])}`;
    // Creators get arrival/departure alerts for shared places by default.
    if (body.circleId) {
      await sql`INSERT INTO place_alerts (place_id, subscriber_id) VALUES (${row!.id}, ${a.userId}) ON CONFLICT DO NOTHING`;
    }
    await audit(ctx, req, 'place.created', { type: 'place', id: row!.id });
    return serializePlace(row!);
  });

  app.patch<{ Params: { id: string } }>('/api/places/:id', async (req) => {
    const a = requireUser(req);
    const p = await loadPlace(ctx, a.userId, parse(uuid, req.params.id));
    if (!(await canEdit(ctx, a.userId, p))) throw forbidden('Only the creator or a circle admin can edit this place');
    const body = parse(placeBody.partial(), req.body);
    if (body.circleId && !(await isCircleMember(sql, body.circleId, a.userId))) throw notFound('Circle not found');
    const [row] = await sql<PlaceRow[]>`
      UPDATE places SET
        name = COALESCE(${body.name ?? null}, name),
        lat = COALESCE(${body.lat ?? null}, lat),
        lon = COALESCE(${body.lon ?? null}, lon),
        radius_m = COALESCE(${body.radiusM ?? null}, radius_m),
        icon = COALESCE(${body.icon ?? null}, icon),
        color = COALESCE(${body.color ?? null}, color),
        circle_id = ${body.circleId === undefined ? sql`circle_id` : body.circleId},
        address = ${body.address === undefined ? sql`address` : body.address},
        updated_at = now()
      WHERE id = ${p.id}
      RETURNING ${sql(PLACE_COLUMNS as unknown as string[])}`;
    // Geometry changed: reset presence so state is re-initialised silently.
    if (body.lat !== undefined || body.lon !== undefined || body.radiusM !== undefined || body.circleId !== undefined) {
      await sql`DELETE FROM place_presence WHERE place_id = ${p.id}`;
    }
    return serializePlace(row!);
  });

  app.delete<{ Params: { id: string } }>('/api/places/:id', async (req) => {
    const a = requireUser(req);
    const p = await loadPlace(ctx, a.userId, parse(uuid, req.params.id));
    if (!(await canEdit(ctx, a.userId, p))) throw forbidden('Only the creator or a circle admin can delete this place');
    await sql`DELETE FROM places WHERE id = ${p.id}`;
    await audit(ctx, req, 'place.deleted', { type: 'place', id: p.id });
    return { ok: true };
  });

  // -- Alerts -------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/places/:id/alerts', async (req) => {
    const a = requireUser(req);
    const p = await loadPlace(ctx, a.userId, parse(uuid, req.params.id));
    const rows = await sql<{ member_id: string | null; on_arrive: boolean; on_depart: boolean }[]>`
      SELECT member_id, on_arrive, on_depart FROM place_alerts WHERE place_id = ${p.id} AND subscriber_id = ${a.userId}`;
    return rows.map((r) => ({ memberId: r.member_id, onArrive: r.on_arrive, onDepart: r.on_depart }));
  });

  app.put<{ Params: { id: string } }>('/api/places/:id/alerts', async (req) => {
    const a = requireUser(req);
    const p = await loadPlace(ctx, a.userId, parse(uuid, req.params.id));
    if (!p.circle_id) throw badRequest('Alerts are only available for places shared with a circle');
    const { alerts } = parse(
      z.object({
        alerts: z.array(z.object({ memberId: uuid.nullable(), onArrive: z.boolean(), onDepart: z.boolean() })).max(100),
      }),
      req.body,
    );
    for (const al of alerts) {
      if (al.memberId && !(await isCircleMember(sql, p.circle_id, al.memberId))) throw badRequest('Member is not in this circle');
    }
    await sql.begin(async (tx) => {
      await tx`DELETE FROM place_alerts WHERE place_id = ${p.id} AND subscriber_id = ${a.userId}`;
      for (const al of alerts) {
        if (!al.onArrive && !al.onDepart) continue;
        await tx`INSERT INTO place_alerts (place_id, subscriber_id, member_id, on_arrive, on_depart)
                 VALUES (${p.id}, ${a.userId}, ${al.memberId}, ${al.onArrive}, ${al.onDepart})`;
      }
    });
    return { ok: true };
  });

  // -- Arrivals / departures feed ----------------------------------------------
  app.get('/api/place-events', async (req) => {
    const a = requireUser(req);
    const q = parse(
      z.object({ placeId: uuid.optional(), userId: uuid.optional(), limit: z.coerce.number().int().min(1).max(200).default(20) }),
      req.query,
    );
    // Events are visible for places the viewer can see, about people whose history they can see.
    const rows = await sql<{ id: number; kind: string; occurred_at: Date; user_id: string; display_name: string; avatar_color: string; avatar_url: string | null; place_id: string; place_name: string; icon: string; color: string }[]>`
      SELECT e.id, e.kind, e.occurred_at, e.user_id, u.display_name, u.avatar_color, u.avatar_url, p.id AS place_id, p.name AS place_name, p.icon, p.color
      FROM place_events e
      JOIN places p ON p.id = e.place_id
      JOIN users u ON u.id = e.user_id
      WHERE (${visiblePlaces(ctx, a.userId)})
        ${q.placeId ? sql`AND e.place_id = ${q.placeId}` : sql``}
        ${q.userId ? sql`AND e.user_id = ${q.userId}` : sql``}
        AND (e.user_id = ${a.userId} OR EXISTS (
          SELECT 1 FROM circle_members me JOIN circle_members t ON t.circle_id = me.circle_id
          JOIN circles c ON c.id = me.circle_id
          WHERE me.user_id = ${a.userId} AND t.user_id = e.user_id AND t.sharing
            AND e.occurred_at >= t.sharing_since AND COALESCE((c.settings ->> 'historyVisible')::boolean, true)))
      ORDER BY e.occurred_at DESC LIMIT ${q.limit}`;
    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind,
      occurredAt: r.occurred_at.toISOString(),
      user: { id: r.user_id, displayName: r.display_name, avatarColor: r.avatar_color, avatarUrl: r.avatar_url },
      place: { id: r.place_id, name: r.place_name, icon: r.icon, color: r.color },
    }));
  });

  // -- Geocoding proxy (keeps users' IPs away from third-party geocoders) ---------
  app.get('/api/geocode/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    requireUser(req);
    const q = parse(
      z.object({ q: z.string().trim().min(2).max(200), lat: z.coerce.number().optional(), lon: z.coerce.number().optional() }),
      req.query,
    );
    const near = q.lat != null && q.lon != null ? { lat: q.lat, lon: q.lon } : undefined;
    return { enabled: await ctx.geocoder.enabled(), results: await ctx.geocoder.search(q.q, near) };
  });

  app.get('/api/geocode/reverse', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    requireUser(req);
    const q = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }), req.query);
    return { label: await ctx.geocoder.reverse(q.lat, q.lon) };
  });
}
