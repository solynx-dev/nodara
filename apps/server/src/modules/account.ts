import type { FastifyInstance, FastifyReply } from 'fastify';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { audit, clearSessionCookie, requireUser } from '../auth.js';
import { verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { deleteUser, loadMe } from '../services/users.js';
import { circleMatesOf, viewersOf } from '../services/access.js';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** Identify an image by its magic bytes; anything else (SVG, HTML…) is refused. */
export function imageMime(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const notifPref = z.object({ inApp: z.boolean(), push: z.boolean() }).partial();

const prefsSchema = z
  .object({
    units: z.enum(['metric', 'imperial']),
    theme: z.enum(['system', 'light', 'dark']),
    mapStyle: z.string().max(60).nullable(),
    updateIntervalSec: z.number().int().min(5).max(3600),
    adaptiveInterval: z.boolean(),
    highAccuracy: z.boolean(),
    retentionDays: z.number().int().min(1).max(36_500).nullable(),
    notifyLowBattery: z.boolean(),
    lowBatteryThreshold: z.number().int().min(5).max(50),
    notifications: z.record(z.enum(['places', 'circle', 'sharing', 'lowBattery', 'deviceOffline']), notifPref),
  })
  .partial();

const csvEscape = (v: unknown) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export default async function accountRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  app.patch('/api/me', async (req) => {
    const a = requireUser(req);
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(60).optional(),
        avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        preferences: prefsSchema.optional(),
      }),
      req.body,
    );
    await sql`
      UPDATE users SET
        display_name = COALESCE(${body.displayName ?? null}, display_name),
        avatar_color = COALESCE(${body.avatarColor ?? null}, avatar_color),
        preferences = preferences || ${sql.json((body.preferences ?? {}) as never)},
        updated_at = now()
      WHERE id = ${a.userId}`;
    if (body.displayName || body.avatarColor) await announceProfile(a.userId);
    return loadMe(sql, a.userId);
  });

  // -- Profile photo ---------------------------------------------------------------
  /** Tell everyone who can see this person to refresh their name / photo. */
  const announceProfile = async (userId: string) => {
    ctx.hub.publish([userId, ...(await circleMatesOf(sql, userId))], { type: 'profile', userId });
  };

  app.put(
    '/api/me/avatar',
    { bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req) => {
      const a = requireUser(req);
      const { image } = parse(z.object({ image: z.string().min(16).max(4 * 1024 * 1024) }), req.body);
      const data = Buffer.from(image.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
      if (data.length > MAX_AVATAR_BYTES) throw badRequest('That photo is too large. Use one under 2 MB.');
      const mime = imageMime(data);
      if (!mime) throw badRequest('Use a JPEG, PNG or WebP photo.');
      await sql`
        INSERT INTO user_avatars (user_id, mime, data) VALUES (${a.userId}, ${mime}, ${data})
        ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`;
      // The version in the URL lets clients cache the image forever.
      const url = `/api/users/${a.userId}/avatar?v=${Date.now().toString(36)}`;
      await sql`UPDATE users SET avatar_url = ${url}, updated_at = now() WHERE id = ${a.userId}`;
      await announceProfile(a.userId);
      return loadMe(sql, a.userId);
    },
  );

  app.delete('/api/me/avatar', async (req) => {
    const a = requireUser(req);
    await sql`DELETE FROM user_avatars WHERE user_id = ${a.userId}`;
    await sql`UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = ${a.userId}`;
    await announceProfile(a.userId);
    return loadMe(sql, a.userId);
  });

  /** Profile photos are visible to the person themself and anyone sharing a circle with them. */
  app.get<{ Params: { id: string } }>('/api/users/:id/avatar', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = requireUser(req);
    const id = parse(z.string().uuid(), req.params.id);
    if (id !== a.userId && !(await circleMatesOf(sql, a.userId)).includes(id)) throw notFound('Photo not found');
    const [row] = await sql<{ mime: string; data: Buffer }[]>`SELECT mime, data FROM user_avatars WHERE user_id = ${id}`;
    if (!row) throw notFound('Photo not found');
    return reply
      .header('Content-Type', row.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'inline')
      .send(row.data);
  });

  /** Global pause: hides live location from every circle at once. */
  app.post('/api/me/sharing', async (req) => {
    const a = requireUser(req);
    const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
    const viewersBefore = await viewersOf(sql, a.userId);
    await sql`UPDATE users SET sharing_paused = ${paused}, updated_at = now() WHERE id = ${a.userId}`;
    if (!paused) {
      // Resuming starts a new visible window, like per-circle sharing.
      await sql`UPDATE circle_members SET sharing_since = now() WHERE user_id = ${a.userId} AND sharing`;
    }
    const viewers = new Set([...viewersBefore, ...(await viewersOf(sql, a.userId))]);
    ctx.hub.publish(viewers, { type: 'sharing', userId: a.userId, circleId: null, sharing: !paused });
    const [u] = await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${a.userId}`;
    for (const v of viewers) {
      if (v === a.userId) continue;
      await ctx.notify.notify({
        userId: v,
        type: 'sharing_changed',
        title: `${u!.display_name} ${paused ? 'paused' : 'resumed'} location sharing`,
        data: { userId: a.userId, sharing: !paused },
        dedupeKey: `pause:${a.userId}:${paused}`,
        dedupeWindowSec: 300,
      });
    }
    return loadMe(sql, a.userId);
  });

  app.delete('/api/me', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const a = requireUser(req);
    const { password, confirm } = parse(z.object({ password: z.string().max(256), confirm: z.literal('DELETE') }), req.body);
    const [u] = await sql<{ password_hash: string | null; is_admin: boolean }[]>`SELECT password_hash, is_admin FROM users WHERE id = ${a.userId}`;
    if (!u?.password_hash || !(await verifyPassword(u.password_hash, password))) {
      throw new HttpError(401, 'invalid_credentials', 'Password is incorrect');
    }
    if (u.is_admin) {
      const { n } = (await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM users WHERE is_admin AND disabled_at IS NULL AND id <> ${a.userId}`)[0]!;
      if (n === 0) throw conflict('You are the only administrator. Promote someone else before deleting your account.');
    }
    await deleteUser(sql, a.userId);
    await audit(ctx, null, 'user.deleted_self', { type: 'user', id: a.userId });
    ctx.hub.disconnectUser(a.userId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // -- Export ---------------------------------------------------------------------
  app.get('/api/me/export', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const a = requireUser(req);
    const q = parse(
      z.object({
        format: z.enum(['json', 'geojson', 'gpx', 'csv']).default('json'),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      }),
      req.query,
    );
    const from = q.from ? new Date(q.from) : new Date(0);
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 86_400_000);
    const stamp = new Date().toISOString().slice(0, 10);
    const types = { json: 'application/json', geojson: 'application/geo+json', gpx: 'application/gpx+xml', csv: 'text/csv' };
    await audit(ctx, req, 'user.export', { type: 'user', id: a.userId }, { format: q.format });
    return streamExport(ctx, reply, a.userId, q.format, from, to, types[q.format], `nodara-export-${stamp}.${q.format}`);
  });
}

async function streamExport(
  ctx: Ctx,
  reply: FastifyReply,
  userId: string,
  format: 'json' | 'geojson' | 'gpx' | 'csv',
  from: Date,
  to: Date,
  type: string,
  filename: string,
) {
  const { sql } = ctx;
  const out = new PassThrough();
  reply.header('Content-Type', `${type}; charset=utf-8`);
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);

  const points = sql`
    SELECT recorded_at, lat, lon, accuracy, altitude, speed, speed_source, heading, battery, charging, activity, device_id
    FROM locations WHERE user_id = ${userId} AND recorded_at >= ${from} AND recorded_at < ${to}
    ORDER BY recorded_at`;

  void (async () => {
    try {
      if (format === 'csv') {
        out.write('recorded_at,lat,lon,accuracy_m,altitude_m,speed_mps,speed_source,heading,battery,charging,activity,device_id\n');
        await points.cursor(2000, (rows) => {
          out.write(rows.map((r) => Object.values(r).map(csvEscape).join(',')).join('\n') + '\n');
        });
      } else if (format === 'gpx') {
        out.write('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Nodara" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>Nodara location history</name><trkseg>\n');
        await points.cursor(2000, (rows) => {
          out.write(
            rows
              .map((r) => `<trkpt lat="${r.lat}" lon="${r.lon}">${r.altitude != null ? `<ele>${r.altitude}</ele>` : ''}<time>${(r.recorded_at as Date).toISOString()}</time></trkpt>`)
              .join('\n') + '\n',
          );
        });
        out.write('</trkseg></trk>\n</gpx>\n');
      } else if (format === 'geojson') {
        out.write('{"type":"FeatureCollection","features":[\n');
        let first = true;
        await points.cursor(2000, (rows) => {
          for (const r of rows) {
            const { lat, lon, ...props } = r;
            out.write(`${first ? '' : ',\n'}${JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })}`);
            first = false;
          }
        });
        out.write('\n]}\n');
      } else {
        // Full account export.
        const [profile] = await sql`SELECT id, email, display_name, created_at, preferences, sharing_paused FROM users WHERE id = ${userId}`;
        const circles = await sql`
          SELECT c.id, c.name, m.role, m.sharing, m.joined_at FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ${userId}`;
        const devices = await sql`SELECT id, name, kind, created_at, last_location_at, revoked_at FROM devices WHERE user_id = ${userId}`;
        const places = await sql`SELECT id, name, lat, lon, radius_m, icon, color, address, circle_id, created_at FROM places WHERE owner_id = ${userId}`;
        const trips = await sql`
          SELECT id, status, started_at, ended_at, duration_sec, distance_m, max_speed, avg_moving_speed, start_lat, start_lon, end_lat,
                 end_lon, start_label, end_label, stops, ST_AsGeoJSON(route)::json AS route
          FROM trips WHERE user_id = ${userId} AND started_at >= ${from} AND started_at < ${to} ORDER BY started_at`;
        const events = await sql`
          SELECT e.kind, e.occurred_at, p.name AS place FROM place_events e JOIN places p ON p.id = e.place_id
          WHERE e.user_id = ${userId} ORDER BY e.occurred_at`;
        out.write(`{"format":"nodara-export","version":1,"exportedAt":${JSON.stringify(new Date())},\n`);
        out.write(`"profile":${JSON.stringify(profile)},\n"circles":${JSON.stringify(circles)},\n"devices":${JSON.stringify(devices)},\n`);
        out.write(`"places":${JSON.stringify(places)},\n"placeEvents":${JSON.stringify(events)},\n"trips":${JSON.stringify(trips)},\n"locations":[\n`);
        let first = true;
        await points.cursor(2000, (rows) => {
          for (const r of rows) {
            out.write(`${first ? '' : ',\n'}${JSON.stringify(r)}`);
            first = false;
          }
        });
        out.write('\n]}\n');
      }
    } catch (err) {
      ctx.log.error({ err }, 'export failed');
      out.write(`\n/* export failed: ${xmlEscape((err as Error).message)} */\n`);
    } finally {
      out.end();
    }
  })();
  return reply.send(out);
}
