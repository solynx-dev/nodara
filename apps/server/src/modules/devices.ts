import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { audit, requireUser } from '../auth.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const uuid = z.string().uuid();
const KINDS = ['web', 'ios', 'android', 'owntracks', 'overland', 'other'] as const;

interface DeviceRow {
  id: string;
  name: string;
  kind: string;
  token_hint: string | null;
  push: boolean;
  last_seen_at: Date | null;
  last_location_at: Date | null;
  created_at: Date;
}

const serialize = (d: DeviceRow) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  tokenHint: d.token_hint,
  pushEnabled: d.push,
  lastSeenAt: d.last_seen_at?.toISOString() ?? null,
  lastLocationAt: d.last_location_at?.toISOString() ?? null,
  createdAt: d.created_at.toISOString(),
});

export default async function deviceRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;
  const COLS = sql`id, name, kind, token_hint, push_subscription IS NOT NULL AS push, last_seen_at, last_location_at, created_at`;

  app.get('/api/devices', async (req) => {
    const a = requireUser(req);
    const rows = await sql<DeviceRow[]>`
      SELECT ${COLS} FROM devices WHERE user_id = ${a.userId} AND revoked_at IS NULL ORDER BY created_at`;
    return rows.map(serialize);
  });

  /**
   * Register a device. Browser/PWA devices authenticate with the session and
   * don't need a token; other kinds (native apps, OwnTracks, Overland) get a
   * device token that is shown exactly once.
   */
  app.post('/api/devices', async (req) => {
    const a = requireUser(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(KINDS).default('web') }), req.body);
    const { n } = (await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM devices WHERE user_id = ${a.userId} AND revoked_at IS NULL`)[0]!;
    if (n >= 25) throw badRequest('Device limit reached — remove an old device first');
    const token = body.kind === 'web' ? null : `ndd_${randomToken()}`;
    const [row] = await sql<DeviceRow[]>`
      INSERT INTO devices (user_id, name, kind, token_hash, token_hint)
      VALUES (${a.userId}, ${body.name}, ${body.kind}, ${token ? sha256(token) : null}, ${token ? token.slice(-4) : null})
      RETURNING ${COLS}`;
    await audit(ctx, req, 'device.created', { type: 'device', id: row!.id }, { kind: body.kind });
    return { device: serialize(row!), token };
  });

  app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    const a = requireUser(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const [row] = await sql<DeviceRow[]>`
      UPDATE devices SET name = ${body.name} WHERE id = ${parse(uuid, req.params.id)} AND user_id = ${a.userId} AND revoked_at IS NULL
      RETURNING ${COLS}`;
    if (!row) throw notFound('Device not found');
    return serialize(row);
  });

  app.post<{ Params: { id: string } }>('/api/devices/:id/token', async (req) => {
    const a = requireUser(req);
    const token = `ndd_${randomToken()}`;
    const [row] = await sql<DeviceRow[]>`
      UPDATE devices SET token_hash = ${sha256(token)}, token_hint = ${token.slice(-4)}
      WHERE id = ${parse(uuid, req.params.id)} AND user_id = ${a.userId} AND revoked_at IS NULL
      RETURNING ${COLS}`;
    if (!row) throw notFound('Device not found');
    await audit(ctx, req, 'device.token_rotated', { type: 'device', id: row.id });
    return { device: serialize(row), token };
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    const a = requireUser(req);
    // Revoke rather than delete so history keeps its device reference.
    const r = await sql`
      UPDATE devices SET revoked_at = now(), token_hash = NULL, push_subscription = NULL
      WHERE id = ${parse(uuid, req.params.id)} AND user_id = ${a.userId} AND revoked_at IS NULL RETURNING id`;
    if (!r.length) throw notFound('Device not found');
    await audit(ctx, req, 'device.revoked', { type: 'device', id: r[0]!.id as string });
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/devices/:id/push', async (req) => {
    const a = requireUser(req);
    const body = parse(
      z.object({
        subscription: z.object({
          endpoint: z.string().url().max(2000),
          expirationTime: z.number().nullish(),
          keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
        }),
      }),
      req.body,
    );
    const r = await sql`
      UPDATE devices SET push_subscription = ${sql.json(body.subscription as never)}
      WHERE id = ${parse(uuid, req.params.id)} AND user_id = ${a.userId} AND revoked_at IS NULL RETURNING id`;
    if (!r.length) throw notFound('Device not found');
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id/push', async (req) => {
    const a = requireUser(req);
    await sql`UPDATE devices SET push_subscription = NULL WHERE id = ${parse(uuid, req.params.id)} AND user_id = ${a.userId}`;
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/devices/:id/push/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const a = requireUser(req);
    const sent = await ctx.push.sendToUser(a.userId, {
      title: 'Nodara notifications are on',
      body: 'You will be notified about arrivals, departures and circle activity.',
      url: '/notifications',
    });
    return { sent };
  });
}
