import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Circle, CircleRole, CircleSettings, MemberLocation } from '@nodara/shared';
import type { Ctx } from '../context.js';
import { audit, requireUser } from '../auth.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { CLOCK_SKEW_GRACE_MS, isCircleMember } from '../services/access.js';
import { serializeLocation, type LocationRow } from '../services/serialize.js';

const DEFAULT_SETTINGS: CircleSettings = { historyVisible: true, tripsVisible: true, membersCanInvite: false };
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const uuid = z.string().uuid();

function settingsOf(raw: Partial<CircleSettings>): CircleSettings {
  return { ...DEFAULT_SETTINGS, ...raw };
}

const RANK: Record<CircleRole, number> = { member: 0, admin: 1, owner: 2 };

async function requireRole(ctx: Ctx, circleId: string, userId: string, min: CircleRole): Promise<CircleRole> {
  const role = (await isCircleMember(ctx.sql, circleId, userId)) as CircleRole | null;
  if (!role) throw notFound('Circle not found');
  if (RANK[role] < RANK[min]) throw forbidden(`Only circle ${min}s can do that`);
  return role;
}

export async function listCircles(ctx: Ctx, userId: string): Promise<Circle[]> {
  const rows = await ctx.sql<
    { id: string; name: string; color: string; role: CircleRole; sharing: boolean; settings: Partial<CircleSettings>; member_count: number; created_at: Date }[]
  >`
    SELECT c.id, c.name, c.color, m.role, m.sharing, c.settings, c.created_at,
           (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id) AS member_count
    FROM circle_members m JOIN circles c ON c.id = m.circle_id
    WHERE m.user_id = ${userId} ORDER BY c.created_at`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    role: r.role,
    sharing: r.sharing,
    memberCount: r.member_count,
    settings: settingsOf(r.settings),
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * Live member list for the map. When `circleId` is null, merges every circle
 * the viewer belongs to. Locations are only included when the member shares
 * with the relevant circle and has not paused sharing.
 */
export async function memberLocations(ctx: Ctx, viewerId: string, circleId: string | null): Promise<MemberLocation[]> {
  const { sql } = ctx;
  const rows = await sql<
    (LocationRow & {
      member_id: string;
      display_name: string;
      avatar_color: string;
      avatar_url: string | null;
      role: CircleRole;
      member_sharing: boolean;
      sharing_paused: boolean;
      device_name: string | null;
      in_trip: boolean;
      loc_id: number | null;
      since: Date | null;
    })[]
  >`
    WITH members AS (
      SELECT t.user_id,
             (array_agg(t.role ORDER BY CASE t.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END))[1] AS role,
             bool_or(t.sharing) AS sharing,
             min(t.sharing_since) FILTER (WHERE t.sharing) AS since
      FROM circle_members me JOIN circle_members t ON t.circle_id = me.circle_id
      WHERE me.user_id = ${viewerId} ${circleId ? sql`AND me.circle_id = ${circleId}` : sql``}
      GROUP BY t.user_id
      ${circleId ? sql`` : sql`UNION SELECT ${viewerId}::uuid, 'owner', true, NULL::timestamptz WHERE NOT EXISTS (SELECT 1 FROM circle_members WHERE user_id = ${viewerId})`}
    )
    SELECT m.user_id AS member_id, u.display_name, u.avatar_color, u.avatar_url, m.role, m.sharing AS member_sharing, m.since,
           u.sharing_paused, d.name AS device_name, l.id AS loc_id,
           l.user_id, l.device_id, l.recorded_at, l.lat, l.lon, l.accuracy, l.altitude, l.speed, l.speed_source,
           l.heading, l.battery, l.charging, l.activity,
           EXISTS (SELECT 1 FROM trips tr WHERE tr.user_id = m.user_id AND tr.status = 'in_progress') AS in_trip
    FROM members m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN latest_locations ll ON ll.user_id = m.user_id
    LEFT JOIN locations l ON l.id = ll.location_id
    LEFT JOIN devices d ON d.id = l.device_id
    ORDER BY (m.user_id = ${viewerId}) DESC, u.display_name`;

  // Which saved place is each member currently at?
  const presence = await sql<{ user_id: string; id: string; name: string; icon: string; color: string }[]>`
    SELECT pp.user_id, p.id, p.name, p.icon, p.color FROM place_presence pp
    JOIN places p ON p.id = pp.place_id
    WHERE pp.inside AND pp.user_id = ANY(${rows.map((r) => r.member_id)}::uuid[])
      AND (p.circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = ${viewerId})
           OR (p.circle_id IS NULL AND p.owner_id = ${viewerId}))
    ORDER BY p.radius_m ASC`;
  const placeOf = new Map<string, MemberLocation['currentPlace']>();
  for (const p of presence) if (!placeOf.has(p.user_id)) placeOf.set(p.user_id, { id: p.id, name: p.name, icon: p.icon, color: p.color });

  return rows.map((r) => {
    const self = r.member_id === viewerId;
    // Like history: never reveal a fix recorded before the member started sharing with the viewer.
    const visible = self || (r.member_sharing && !r.sharing_paused && (!r.recorded_at || !r.since || r.recorded_at.getTime() >= r.since.getTime() - CLOCK_SKEW_GRACE_MS));
    const sharing = r.member_sharing && !r.sharing_paused;
    return {
      id: r.member_id,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      avatarUrl: r.avatar_url,
      role: r.role,
      sharing,
      location: visible && r.loc_id != null ? serializeLocation({ ...r, id: r.loc_id }) : null,
      deviceName: visible ? r.device_name : null,
      currentPlace: visible ? placeOf.get(r.member_id) ?? null : null,
      inTrip: visible && r.in_trip,
    };
  });
}

export async function findInvitation(ctx: Ctx, token: string) {
  const [inv] = await ctx.sql<{ id: string; circle_id: string; role: 'admin' | 'member'; circle_name: string; circle_color: string; inviter: string | null; expires_at: Date }[]>`
    SELECT i.id, i.circle_id, i.role, c.name AS circle_name, c.color AS circle_color, u.display_name AS inviter, i.expires_at
    FROM invitations i JOIN circles c ON c.id = i.circle_id LEFT JOIN users u ON u.id = i.created_by
    WHERE i.token_hash = ${sha256(token)} AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses`;
  return inv ?? null;
}

export async function acceptInvitation(ctx: Ctx, token: string, userId: string) {
  return ctx.sql.begin(async (tx) => {
    const [inv] = await tx<{ id: string; circle_id: string; role: string }[]>`
      UPDATE invitations SET uses = uses + 1
      WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses
      RETURNING id, circle_id, role`;
    if (!inv) throw badRequest('This invitation is invalid or has expired');
    const existing = await tx`SELECT 1 FROM circle_members WHERE circle_id = ${inv.circle_id} AND user_id = ${userId}`;
    if (existing.length) {
      // Don't burn a use on someone already in the circle.
      await tx`UPDATE invitations SET uses = uses - 1 WHERE id = ${inv.id}`;
      return { circleId: inv.circle_id, alreadyMember: true };
    }
    await tx`INSERT INTO circle_members (circle_id, user_id, role) VALUES (${inv.circle_id}, ${userId}, ${inv.role})`;
    return { circleId: inv.circle_id, alreadyMember: false };
  }).then(async (r) => {
    if (!r.alreadyMember) {
      const [u] = await ctx.sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`;
      const [c] = await ctx.sql<{ name: string }[]>`SELECT name FROM circles WHERE id = ${r.circleId}`;
      const mates = await ctx.sql<{ user_id: string }[]>`
        SELECT user_id FROM circle_members WHERE circle_id = ${r.circleId} AND user_id <> ${userId}`;
      for (const m of mates) {
        await ctx.notify.notify({
          userId: m.user_id,
          type: 'member_joined',
          title: `${u?.display_name ?? 'Someone'} joined ${c?.name ?? 'your circle'}`,
          data: { circleId: r.circleId, userId },
          url: `/circles/${r.circleId}`,
        });
      }
      ctx.hub.publish([userId, ...mates.map((m) => m.user_id)], { type: 'circle', circleId: r.circleId });
    }
    return r;
  });
}

export default async function circleRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  app.get('/api/circles', async (req) => listCircles(ctx, requireUser(req).userId));

  app.post('/api/circles', async (req) => {
    const a = requireUser(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), color: colorSchema.default('#FF7A45') }), req.body);
    const { n } = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM circle_members WHERE user_id = ${a.userId}`)[0]!;
    if (n >= 50) throw badRequest('You can belong to at most 50 circles');
    const id = await sql.begin(async (tx) => {
      const [c] = await tx<{ id: string }[]>`
        INSERT INTO circles (name, color, created_by, settings) VALUES (${body.name}, ${body.color}, ${a.userId}, ${tx.json(DEFAULT_SETTINGS as never)})
        RETURNING id`;
      await tx`INSERT INTO circle_members (circle_id, user_id, role) VALUES (${c!.id}, ${a.userId}, 'owner')`;
      return c!.id;
    });
    return (await listCircles(ctx, a.userId)).find((c) => c.id === id);
  });

  app.get<{ Params: { id: string } }>('/api/circles/:id', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    const circle = (await listCircles(ctx, a.userId)).find((c) => c.id === id);
    if (!circle) throw notFound('Circle not found');
    const members = await sql<{ user_id: string; display_name: string; email: string; avatar_color: string; avatar_url: string | null; role: CircleRole; sharing: boolean; sharing_paused: boolean; joined_at: Date }[]>`
      SELECT m.user_id, u.display_name, u.email, u.avatar_color, u.avatar_url, m.role, m.sharing, u.sharing_paused, m.joined_at
      FROM circle_members m JOIN users u ON u.id = m.user_id
      WHERE m.circle_id = ${id} ORDER BY m.joined_at`;
    const [mine] = await sql<{ notify_settings: Record<string, unknown> }[]>`
      SELECT notify_settings FROM circle_members WHERE circle_id = ${id} AND user_id = ${a.userId}`;
    return {
      ...circle,
      notify: { muted: false, ...(mine?.notify_settings ?? {}) },
      members: members.map((m) => ({
        id: m.user_id,
        displayName: m.display_name,
        // Emails are only shown to circle admins.
        email: circle.role !== 'member' || m.user_id === a.userId ? m.email : null,
        avatarColor: m.avatar_color,
        avatarUrl: m.avatar_url,
        role: m.role,
        sharing: m.sharing && !m.sharing_paused,
        joinedAt: m.joined_at.toISOString(),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/circles/:id', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    await requireRole(ctx, id, a.userId, 'admin');
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        color: colorSchema.optional(),
        settings: z.object({ historyVisible: z.boolean(), tripsVisible: z.boolean(), membersCanInvite: z.boolean() }).partial().optional(),
      }),
      req.body,
    );
    await sql`
      UPDATE circles SET
        name = COALESCE(${body.name ?? null}, name),
        color = COALESCE(${body.color ?? null}, color),
        settings = settings || ${sql.json((body.settings ?? {}) as never)}
      WHERE id = ${id}`;
    await audit(ctx, req, 'circle.updated', { type: 'circle', id }, body);
    const mates = await sql<{ user_id: string }[]>`SELECT user_id FROM circle_members WHERE circle_id = ${id}`;
    ctx.hub.publish(mates.map((m) => m.user_id), { type: 'circle', circleId: id });
    return (await listCircles(ctx, a.userId)).find((c) => c.id === id);
  });

  app.delete<{ Params: { id: string } }>('/api/circles/:id', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    await requireRole(ctx, id, a.userId, 'owner');
    const mates = await sql<{ user_id: string }[]>`SELECT user_id FROM circle_members WHERE circle_id = ${id}`;
    await sql`DELETE FROM circles WHERE id = ${id}`;
    await audit(ctx, req, 'circle.deleted', { type: 'circle', id });
    ctx.hub.publish(mates.map((m) => m.user_id), { type: 'circle', circleId: id });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/circles/:id/live', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    await requireRole(ctx, id, a.userId, 'member');
    return memberLocations(ctx, a.userId, id);
  });

  app.get('/api/live', async (req) => memberLocations(ctx, requireUser(req).userId, null));

  // Update my own membership: sharing toggle and notification settings.
  app.patch<{ Params: { id: string } }>('/api/circles/:id/me', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    await requireRole(ctx, id, a.userId, 'member');
    const body = parse(z.object({ sharing: z.boolean().optional(), notify: z.object({ muted: z.boolean() }).partial().optional() }), req.body);
    if (body.sharing !== undefined) {
      // Re-enabling sharing resets sharing_since so the gap stays private.
      await sql`
        UPDATE circle_members SET
          sharing = ${body.sharing},
          sharing_since = CASE WHEN ${body.sharing} AND NOT sharing THEN now() ELSE sharing_since END
        WHERE circle_id = ${id} AND user_id = ${a.userId}`;
      const mates = await sql<{ user_id: string }[]>`SELECT user_id FROM circle_members WHERE circle_id = ${id}`;
      ctx.hub.publish(mates.map((m) => m.user_id), { type: 'sharing', userId: a.userId, circleId: id, sharing: body.sharing });
      const [u] = await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${a.userId}`;
      const [c] = await sql<{ name: string }[]>`SELECT name FROM circles WHERE id = ${id}`;
      for (const m of mates) {
        if (m.user_id === a.userId) continue;
        await ctx.notify.notify({
          userId: m.user_id,
          type: 'sharing_changed',
          title: `${u!.display_name} ${body.sharing ? 'resumed' : 'stopped'} sharing location with ${c!.name}`,
          data: { userId: a.userId, circleId: id, sharing: body.sharing },
          dedupeKey: `sharing:${a.userId}:${id}:${body.sharing}`,
          dedupeWindowSec: 300,
        });
      }
    }
    if (body.notify) {
      await sql`UPDATE circle_members SET notify_settings = notify_settings || ${sql.json(body.notify as never)}
                WHERE circle_id = ${id} AND user_id = ${a.userId}`;
    }
    return { ok: true };
  });

  app.patch<{ Params: { id: string; userId: string } }>('/api/circles/:id/members/:userId', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    const target = parse(uuid, req.params.userId);
    const myRole = await requireRole(ctx, id, a.userId, 'admin');
    const { role } = parse(z.object({ role: z.enum(['owner', 'admin', 'member']) }), req.body);
    const targetRole = (await isCircleMember(sql, id, target)) as CircleRole | null;
    if (!targetRole) throw notFound('Member not found');
    if (target === a.userId) throw badRequest("You can't change your own role");
    if (myRole !== 'owner' && (role === 'owner' || targetRole === 'owner')) throw forbidden('Only the owner can transfer ownership');
    await sql.begin(async (tx) => {
      if (role === 'owner') {
        // Transfer ownership: previous owner becomes admin.
        await tx`UPDATE circle_members SET role = 'admin' WHERE circle_id = ${id} AND user_id = ${a.userId}`;
      }
      await tx`UPDATE circle_members SET role = ${role} WHERE circle_id = ${id} AND user_id = ${target}`;
    });
    await audit(ctx, req, 'circle.member_role', { type: 'circle', id }, { target, role });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/circles/:id/members/:userId', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    const target = parse(uuid, req.params.userId);
    const targetRole = (await isCircleMember(sql, id, target)) as CircleRole | null;
    if (target === a.userId) {
      if (!targetRole) throw notFound('Circle not found');
      if (targetRole === 'owner') {
        const [o] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM circle_members WHERE circle_id = ${id}`;
        if (o!.n > 1) throw conflict('Transfer ownership to someone else before leaving, or delete the circle');
        await sql`DELETE FROM circles WHERE id = ${id}`;
        return { ok: true, deleted: true };
      }
    } else {
      const myRole = await requireRole(ctx, id, a.userId, 'admin');
      if (!targetRole) throw notFound('Member not found');
      if (RANK[targetRole] >= RANK[myRole]) throw forbidden('You can only remove members with a lower role');
    }
    await sql`DELETE FROM circle_members WHERE circle_id = ${id} AND user_id = ${target}`;
    // Alert subscriptions in this circle no longer apply.
    await sql`DELETE FROM place_alerts WHERE subscriber_id = ${target} AND place_id IN (SELECT id FROM places WHERE circle_id = ${id})`;
    await audit(ctx, req, target === a.userId ? 'circle.left' : 'circle.member_removed', { type: 'circle', id }, { target });
    const mates = await sql<{ user_id: string }[]>`SELECT user_id FROM circle_members WHERE circle_id = ${id}`;
    ctx.hub.publish([target, ...mates.map((m) => m.user_id)], { type: 'circle', circleId: id });
    return { ok: true };
  });

  // -- Invitations -----------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/circles/:id/invitations', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    await requireRole(ctx, id, a.userId, 'admin');
    const rows = await sql<{ id: string; role: string; max_uses: number; uses: number; expires_at: Date; created_at: Date; note: string | null; creator: string | null }[]>`
      SELECT i.id, i.role, i.max_uses, i.uses, i.expires_at, i.created_at, i.note, u.display_name AS creator
      FROM invitations i LEFT JOIN users u ON u.id = i.created_by
      WHERE i.circle_id = ${id} AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
      ORDER BY i.created_at DESC`;
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      maxUses: r.max_uses,
      uses: r.uses,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      note: r.note,
      createdBy: r.creator,
    }));
  });

  app.post<{ Params: { id: string } }>('/api/circles/:id/invitations', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    const role = (await isCircleMember(sql, id, a.userId)) as CircleRole | null;
    if (!role) throw notFound('Circle not found');
    const [c] = await sql<{ settings: Partial<CircleSettings> }[]>`SELECT settings FROM circles WHERE id = ${id}`;
    if (role === 'member' && !settingsOf(c!.settings).membersCanInvite) throw forbidden('Only circle admins can invite people');
    const body = parse(
      z.object({
        role: z.enum(['admin', 'member']).default('member'),
        expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
        maxUses: z.number().int().min(1).max(50).default(1),
        note: z.string().trim().max(100).optional(),
      }),
      req.body,
    );
    if (body.role === 'admin' && role === 'member') throw forbidden('Only admins can invite admins');
    const token = randomToken(24);
    const [inv] = await sql<{ id: string; expires_at: Date }[]>`
      INSERT INTO invitations (circle_id, token_hash, role, created_by, max_uses, expires_at, note)
      VALUES (${id}, ${sha256(token)}, ${body.role}, ${a.userId}, ${body.maxUses},
              now() + make_interval(hours => ${body.expiresInHours}), ${body.note ?? null})
      RETURNING id, expires_at`;
    await audit(ctx, req, 'circle.invitation_created', { type: 'circle', id }, { invitationId: inv!.id, role: body.role });
    return { id: inv!.id, token, url: `${ctx.config.PUBLIC_URL}/join/${token}`, expiresAt: inv!.expires_at };
  });

  app.delete<{ Params: { id: string; inviteId: string } }>('/api/circles/:id/invitations/:inviteId', async (req) => {
    const a = requireUser(req);
    const id = parse(uuid, req.params.id);
    await requireRole(ctx, id, a.userId, 'admin');
    const r = await sql`UPDATE invitations SET revoked_at = now() WHERE id = ${parse(uuid, req.params.inviteId)} AND circle_id = ${id} RETURNING id`;
    if (!r.length) throw notFound();
    return { ok: true };
  });

  // Public preview so the join page can show what you're joining.
  app.get<{ Params: { token: string } }>('/api/invitations/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const inv = await findInvitation(ctx, req.params.token);
    if (!inv) throw notFound('This invitation is invalid or has expired');
    const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM circle_members WHERE circle_id = ${inv.circle_id}`;
    return {
      circleName: inv.circle_name,
      circleColor: inv.circle_color,
      invitedBy: inv.inviter,
      role: inv.role,
      memberCount: n!.n,
      expiresAt: inv.expires_at,
    };
  });

  app.post<{ Params: { token: string } }>('/api/invitations/:token/accept', async (req) => {
    const a = requireUser(req);
    const r = await acceptInvitation(ctx, req.params.token, a.userId);
    await audit(ctx, req, 'circle.joined', { type: 'circle', id: r.circleId });
    return r;
  });
}
