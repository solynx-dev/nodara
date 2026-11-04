import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { audit, requireUser } from '../auth.js';
import { badRequest } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import {
  BUBBLE_MAX_HOURS,
  BUBBLE_MAX_RADIUS_M,
  BUBBLE_MIN_RADIUS_M,
  bubbleCircles,
  currentBubble,
  endBubble,
  serializeBubble,
  startBubble,
} from '../services/bubbles.js';

export default async function bubbleRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  const state = async (userId: string) => {
    const b = await currentBubble(sql, userId);
    const circles = await bubbleCircles(sql, userId);
    return { bubble: b ? serializeBubble(b) : null, circles };
  };

  /** Your bubble, and which of your circles it applies to. */
  app.get('/api/bubble', async (req) => state(requireUser(req).userId));

  app.post('/api/bubble', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const a = requireUser(req);
    const body = parse(
      z.object({
        radiusM: z.number().int().min(BUBBLE_MIN_RADIUS_M).max(BUBBLE_MAX_RADIUS_M),
        hours: z.number().min(0.25).max(BUBBLE_MAX_HOURS),
        // Where the phone is now; otherwise the last location the server has.
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
      }),
      req.body,
    );
    const circles = await bubbleCircles(sql, a.userId);
    if (circles.length && !circles.some((c) => c.allowed)) {
      throw badRequest('Bubbles are turned off in all of your circles. A circle owner or admin can turn them on.');
    }
    let pos = body.lat != null && body.lon != null ? { lat: body.lat, lon: body.lon } : null;
    if (!pos) {
      const [l] = await sql<{ lat: number; lon: number }[]>`
        SELECT l.lat, l.lon FROM latest_locations ll JOIN locations l ON l.id = ll.location_id WHERE ll.user_id = ${a.userId}`;
      pos = l ?? null;
    }
    if (!pos) throw badRequest("Nodara doesn't know where you are yet. Turn on location sharing first.");
    await startBubble(ctx, a.userId, { radiusM: body.radiusM, hours: body.hours, ...pos });
    await audit(ctx, req, 'bubble.started', { type: 'user', id: a.userId }, { radiusM: body.radiusM, hours: body.hours });
    return state(a.userId);
  });

  app.delete('/api/bubble', async (req) => {
    const a = requireUser(req);
    if (await endBubble(ctx, a.userId, 'ended')) await audit(ctx, req, 'bubble.ended', { type: 'user', id: a.userId });
    return state(a.userId);
  });
}
