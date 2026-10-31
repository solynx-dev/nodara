import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from './context.js';
import { randomToken, sha256 } from './lib/crypto.js';
import { forbidden, HttpError, unauthorized } from './lib/errors.js';

export const SESSION_COOKIE = 'nodara_session';
export const CSRF_HEADER = 'x-nodara-request';

export interface AuthInfo {
  userId: string;
  sessionId: string | null;
  deviceId: string | null;
  isAdmin: boolean;
  state: 'active' | 'pending_2fa';
  via: 'cookie' | 'bearer' | 'device';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}

export async function createSession(
  ctx: Ctx,
  req: FastifyRequest,
  userId: string,
  state: 'active' | 'pending_2fa' = 'active',
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = `nds_${randomToken()}`;
  const ttlMs = state === 'pending_2fa' ? 10 * 60_000 : ctx.config.SESSION_TTL_DAYS * 86_400_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const [row] = await ctx.sql<{ id: string }[]>`
    INSERT INTO sessions (user_id, token_hash, state, user_agent, ip, expires_at)
    VALUES (${userId}, ${sha256(token)}, ${state}, ${req.headers['user-agent']?.slice(0, 300) ?? null}, ${req.ip}, ${expiresAt})
    RETURNING id`;
  return { token, id: row!.id, expiresAt };
}

export function setSessionCookie(ctx: Ctx, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.secureCookies,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolves the caller from (in order) a device token, a bearer session token,
 * or the session cookie. Cookie-authenticated unsafe requests must carry the
 * custom CSRF header — browsers will not send custom headers cross-origin
 * without a CORS preflight, which Nodara never grants — and a matching Origin.
 */
export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    req.auth = null;
    if (!req.url.startsWith('/api/')) return;

    const header = req.headers.authorization;
    let token: string | undefined;
    let via: AuthInfo['via'] = 'cookie';
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
      via = 'bearer';
    } else {
      token = req.cookies[SESSION_COOKIE];
    }
    if (!token) return;

    if (token.startsWith('ndd_')) {
      req.auth = await resolveDeviceToken(ctx, token);
      return;
    }

    const rows = await ctx.sql<{ id: string; user_id: string; state: 'active' | 'pending_2fa'; is_admin: boolean; last_seen_at: Date }[]>`
      SELECT s.id, s.user_id, s.state, u.is_admin, s.last_seen_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now() AND u.disabled_at IS NULL`;
    const s = rows[0];
    if (!s) return;

    if (via === 'cookie' && UNSAFE.has(req.method)) {
      if (req.headers[CSRF_HEADER] !== '1') throw new HttpError(403, 'csrf', 'Missing CSRF header');
      const origin = req.headers.origin;
      if (origin && origin !== ctx.config.origin && !isSameHost(origin, req)) {
        throw new HttpError(403, 'csrf', 'Cross-origin request rejected');
      }
    }

    req.auth = { userId: s.user_id, sessionId: s.id, deviceId: null, isAdmin: s.is_admin, state: s.state, via };
    // Throttle last-seen writes to once a minute per session.
    if (Date.now() - s.last_seen_at.getTime() > 60_000) {
      void ctx.sql`UPDATE sessions SET last_seen_at = now(), ip = ${req.ip} WHERE id = ${s.id}`.catch(() => {});
    }
  });
}

function isSameHost(origin: string, req: FastifyRequest) {
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export async function resolveDeviceToken(ctx: Ctx, token: string): Promise<AuthInfo | null> {
  const rows = await ctx.sql<{ id: string; user_id: string; is_admin: boolean }[]>`
    SELECT d.id, d.user_id, u.is_admin FROM devices d JOIN users u ON u.id = d.user_id
    WHERE d.token_hash = ${sha256(token)} AND d.revoked_at IS NULL AND u.disabled_at IS NULL`;
  const d = rows[0];
  if (!d) return null;
  // Device tokens are deliberately narrow: they can only submit locations.
  return { userId: d.user_id, sessionId: null, deviceId: d.id, isAdmin: false, state: 'active', via: 'device' };
}

/** Require a fully authenticated user session (not a device token, not pending 2FA). */
export function requireUser(req: FastifyRequest): AuthInfo {
  const a = req.auth;
  if (!a || a.state !== 'active' || a.via === 'device') throw unauthorized();
  return a;
}

export function requireAdmin(req: FastifyRequest): AuthInfo {
  const a = requireUser(req);
  if (!a.isAdmin) throw forbidden('Administrator access required');
  return a;
}

export async function audit(
  ctx: Ctx,
  req: FastifyRequest | null,
  action: string,
  target?: { type: string; id: string },
  details: Record<string, unknown> = {},
) {
  await ctx.sql`
    INSERT INTO audit_log (actor_id, action, target_type, target_id, details, ip)
    VALUES (${req?.auth?.userId ?? null}, ${action}, ${target?.type ?? null}, ${target?.id ?? null},
            ${ctx.sql.json(details as never)}, ${req?.ip ?? null})`;
}
