import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { audit, requireAdmin } from '../auth.js';
import { hashPassword } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { deleteUser, pickAvatarColor } from '../services/users.js';
import { runRetention, telemetryPayload } from '../services/jobs.js';
import { createAdminInviteLink, passwordSchema } from './auth.js';
import { VERSION } from '../version.js';

const uuid = z.string().uuid();

export default async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const [counts] = await sql<Record<string, number>[]>`
      SELECT (SELECT count(*)::int FROM users WHERE NOT is_demo) AS users,
             (SELECT count(*)::int FROM users WHERE is_demo) AS demo_users,
             (SELECT count(*)::int FROM circles) AS circles,
             (SELECT count(*)::int FROM devices WHERE revoked_at IS NULL) AS devices,
             (SELECT count(*)::bigint FROM locations) AS locations,
             (SELECT count(*)::int FROM trips WHERE status = 'completed') AS trips,
             (SELECT count(*)::int FROM places) AS places,
             (SELECT count(*)::int FROM notifications) AS notifications,
             (SELECT count(*)::int FROM notifications WHERE created_at > now() - interval '24 hours') AS notifications_24h,
             (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions`;
    const tables = await sql<{ name: string; bytes: number; rows: number }[]>`
      SELECT relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes, c.reltuples::bigint AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY bytes DESC LIMIT 12`;
    const [db] = await sql<{ size: number; version: string; postgis: string }[]>`
      SELECT pg_database_size(current_database())::bigint AS size, current_setting('server_version') AS version,
             postgis_lib_version() AS postgis`;
    const ingest = await sql<{ hour: Date; accepted: number; rejected: number }[]>`
      SELECT hour, accepted, rejected FROM ingest_stats WHERE hour > now() - interval '48 hours' ORDER BY hour`;
    const [oldest] = await sql<{ t: Date | null }[]>`SELECT min(recorded_at) AS t FROM locations`;
    const notifTypes = await sql<{ type: string; n: number }[]>`
      SELECT type, count(*)::int AS n FROM notifications WHERE created_at > now() - interval '7 days' GROUP BY type ORDER BY n DESC`;
    return {
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      realtimeConnections: ctx.hub.connectionCount,
      counts,
      database: { sizeBytes: db!.size, version: db!.version, postgis: db!.postgis, tables, oldestLocation: oldest?.t ?? null },
      ingest: ingest.map((r) => ({ hour: r.hour.toISOString(), accepted: r.accepted, rejected: r.rejected })),
      notifications: { last7Days: notifTypes },
      email: ctx.mailer.enabled,
      geocoder: Boolean(ctx.config.GEOCODER_URL),
      push: Boolean(ctx.push.publicKey),
    };
  });

  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const rows = await sql<{ id: string; email: string; display_name: string; is_admin: boolean; is_demo: boolean; disabled_at: Date | null; email_verified_at: Date | null; created_at: Date; last_seen: Date | null; locations: number; avatar_color: string; totp: boolean }[]>`
      SELECT u.id, u.email, u.display_name, u.is_admin, u.is_demo, u.disabled_at, u.email_verified_at, u.created_at, u.avatar_color,
             u.totp_enabled_at IS NOT NULL AS totp,
             (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen,
             (SELECT count(*)::int FROM locations l WHERE l.user_id = u.id) AS locations
      FROM users u ORDER BY u.is_demo, u.created_at`;
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      isAdmin: r.is_admin,
      isDemo: r.is_demo,
      disabled: Boolean(r.disabled_at),
      emailVerified: Boolean(r.email_verified_at),
      totp: r.totp,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen,
      locations: r.locations,
    }));
  });

  app.post('/api/admin/users', async (req) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        displayName: z.string().trim().min(1).max(60),
        password: passwordSchema.optional(),
        isAdmin: z.boolean().default(false),
      }),
      req.body,
    );
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, password_hash, is_admin, email_verified_at, avatar_color)
      VALUES (${body.email}, ${body.displayName}, ${body.password ? await hashPassword(body.password) : null}, ${body.isAdmin},
              now(), ${pickAvatarColor(body.email)})
      ON CONFLICT (email) DO NOTHING RETURNING id`;
    if (!u) throw conflict('A user with this email already exists');
    // Without a password, the admin gets a one-time link to hand to the person.
    const setupLink = body.password ? null : await createAdminInviteLink(ctx, u.id);
    if (setupLink) {
      await ctx.mailer.send(body.email, `Your ${ctx.config.INSTANCE_NAME} account`, `An account was created for you.\n\nChoose a password here: ${setupLink}\n\nThe link expires in 7 days.`);
    }
    await audit(ctx, req, 'admin.user_created', { type: 'user', id: u.id }, { isAdmin: body.isAdmin });
    return { id: u.id, setupLink };
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const a = requireAdmin(req);
    const id = parse(uuid, req.params.id);
    const body = parse(z.object({ isAdmin: z.boolean().optional(), disabled: z.boolean().optional() }), req.body);
    if (id === a.userId && (body.isAdmin === false || body.disabled)) throw badRequest("You can't demote or disable yourself");
    const r = await sql`
      UPDATE users SET
        is_admin = COALESCE(${body.isAdmin ?? null}, is_admin),
        disabled_at = CASE WHEN ${body.disabled ?? null}::boolean IS NULL THEN disabled_at
                           WHEN ${body.disabled ?? null}::boolean THEN COALESCE(disabled_at, now()) ELSE NULL END
      WHERE id = ${id} RETURNING id`;
    if (!r.length) throw notFound('User not found');
    if (body.disabled) {
      await sql`DELETE FROM sessions WHERE user_id = ${id}`;
      ctx.hub.disconnectUser(id);
    }
    await audit(ctx, req, 'admin.user_updated', { type: 'user', id }, body);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-link', async (req) => {
    requireAdmin(req);
    const id = parse(uuid, req.params.id);
    const [u] = await sql`SELECT 1 FROM users WHERE id = ${id}`;
    if (!u) throw notFound('User not found');
    const link = await createAdminInviteLink(ctx, id);
    await audit(ctx, req, 'admin.reset_link', { type: 'user', id });
    return { link };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const a = requireAdmin(req);
    const id = parse(uuid, req.params.id);
    if (id === a.userId) throw badRequest('Delete your own account from Settings instead');
    const [u] = await sql`SELECT 1 FROM users WHERE id = ${id}`;
    if (!u) throw notFound('User not found');
    await deleteUser(sql, id);
    ctx.hub.disconnectUser(id);
    await audit(ctx, req, 'admin.user_deleted', { type: 'user', id });
    return { ok: true };
  });

  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return { settings: await ctx.settings.get(), telemetryEndpointConfigured: Boolean(ctx.config.TELEMETRY_ENDPOINT) };
  });

  app.patch('/api/admin/settings', async (req) => {
    requireAdmin(req);
    const body = parse(
      z.object({
        registrationPolicy: z.enum(['open', 'invite', 'closed']),
        defaultRetentionDays: z.number().int().min(0).max(36_500),
        telemetryEnabled: z.boolean(),
        geocodingEnabled: z.boolean(),
        offlineAfterMinutes: z.number().int().min(10).max(7 * 24 * 60),
        geofenceCooldownSec: z.number().int().min(0).max(3600),
        trip: z
          .object({
            departRadiusM: z.number().min(50).max(2000),
            endAfterSec: z.number().int().min(60).max(3600),
            minDistanceM: z.number().min(50).max(10_000),
          })
          .partial(),
      }).partial(),
      req.body,
    );
    const settings = await ctx.settings.update(body);
    await audit(ctx, req, 'admin.settings_updated', undefined, body);
    return { settings };
  });

  app.get('/api/admin/audit', async (req) => {
    requireAdmin(req);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const rows = await sql<{ id: number; action: string; target_type: string | null; target_id: string | null; details: unknown; ip: string | null; created_at: Date; actor: string | null }[]>`
      SELECT a.id, a.action, a.target_type, a.target_id, a.details, host(a.ip) AS ip, a.created_at, u.display_name AS actor
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT ${q.limit}`;
    return rows.map((r) => ({
      id: String(r.id),
      action: r.action,
      target: r.target_type ? { type: r.target_type, id: r.target_id } : null,
      details: r.details,
      ip: r.ip,
      actor: r.actor,
      createdAt: r.created_at,
    }));
  });

  app.get('/api/admin/retention/preview', async (req) => {
    requireAdmin(req);
    return { affected: await runRetention(ctx, { dryRun: true }) };
  });

  app.post('/api/admin/retention/run', async (req) => {
    requireAdmin(req);
    const results = await runRetention(ctx);
    await audit(ctx, req, 'admin.retention_run', undefined, { users: results.length });
    return { results };
  });

  app.get('/api/admin/telemetry/preview', async (req) => {
    requireAdmin(req);
    return { payload: await telemetryPayload(ctx), endpoint: ctx.config.TELEMETRY_ENDPOINT || null };
  });

  app.delete('/api/admin/demo', async (req) => {
    requireAdmin(req);
    const users = await sql`DELETE FROM users WHERE is_demo RETURNING id`;
    await sql`DELETE FROM circles WHERE is_demo`;
    await sql`DELETE FROM circles c WHERE NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id)`;
    await audit(ctx, req, 'admin.demo_purged', undefined, { users: users.length });
    return { removedUsers: users.length };
  });
}
