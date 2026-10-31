import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { requireUser } from '../auth.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { serializeNotification } from '../services/notify.js';

export default async function notificationRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  app.get('/api/notifications', async (req) => {
    const a = requireUser(req);
    const q = parse(
      z.object({
        before: z.string().datetime({ offset: true }).optional(),
        unread: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      }),
      req.query,
    );
    const rows = await sql<Parameters<typeof serializeNotification>[0][]>`
      SELECT id, type, title, body, data, read_at, created_at FROM notifications
      WHERE user_id = ${a.userId}
        ${q.before ? sql`AND created_at < ${new Date(q.before)}` : sql``}
        ${q.unread === 'true' ? sql`AND read_at IS NULL` : sql``}
      ORDER BY created_at DESC LIMIT ${q.limit}`;
    const { unread } = (await sql<{ unread: number }[]>`
      SELECT count(*)::int AS unread FROM notifications WHERE user_id = ${a.userId} AND read_at IS NULL`)[0]!;
    return { items: rows.map(serializeNotification), unread };
  });

  app.post('/api/notifications/read', async (req) => {
    const a = requireUser(req);
    const body = parse(z.object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() }), req.body);
    if (body.all) await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${a.userId} AND read_at IS NULL`;
    else if (body.ids?.length) {
      await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${a.userId} AND id = ANY(${body.ids}::uuid[]) AND read_at IS NULL`;
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/notifications/:id', async (req) => {
    const a = requireUser(req);
    const r = await sql`DELETE FROM notifications WHERE id = ${parse(z.string().uuid(), req.params.id)} AND user_id = ${a.userId} RETURNING id`;
    if (!r.length) throw notFound();
    return { ok: true };
  });

  app.delete('/api/notifications', async (req) => {
    const a = requireUser(req);
    await sql`DELETE FROM notifications WHERE user_id = ${a.userId} AND read_at IS NOT NULL`;
    return { ok: true };
  });
}
