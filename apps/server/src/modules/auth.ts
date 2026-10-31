import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import {
  audit,
  clearSessionCookie,
  createSession,
  requireUser,
  setSessionCookie,
  SESSION_COOKIE,
} from '../auth.js';
import { dummyPasswordHash, hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../lib/totp.js';
import { loadMe, pickAvatarColor } from '../services/users.js';
import { acceptInvitation, findInvitation } from './circles.js';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(256, 'Password is too long');
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const nameSchema = z.string().trim().min(1).max(60);

const AUTH_RATE = { max: 10, timeWindow: '1 minute' };

export async function userCount(ctx: Ctx) {
  const [r] = await ctx.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE NOT is_demo`;
  return r!.n;
}

async function issueToken(ctx: Ctx, userId: string, purpose: 'verify_email' | 'reset_password' | 'admin_invite', hours: number) {
  const token = randomToken();
  await ctx.sql`
    INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
    VALUES (${sha256(token)}, ${userId}, ${purpose}, now() + make_interval(hours => ${hours}))`;
  return token;
}

async function consumeToken(ctx: Ctx, token: string, purpose: string) {
  const [row] = await ctx.sql<{ user_id: string }[]>`
    UPDATE auth_tokens SET used_at = now()
    WHERE token_hash = ${sha256(token)} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id`;
  return row?.user_id ?? null;
}

export async function sendVerification(ctx: Ctx, userId: string, email: string) {
  const token = await issueToken(ctx, userId, 'verify_email', 48);
  await ctx.mailer.send(
    email,
    `Verify your ${ctx.config.INSTANCE_NAME} email`,
    `Confirm your email address by opening this link:\n\n${ctx.config.PUBLIC_URL}/verify-email?token=${token}\n\nThe link expires in 48 hours.`,
  );
}

export async function createAdminInviteLink(ctx: Ctx, userId: string) {
  const token = await issueToken(ctx, userId, 'admin_invite', 7 * 24);
  return `${ctx.config.PUBLIC_URL}/reset-password?token=${token}&welcome=1`;
}

async function startSession(ctx: Ctx, req: FastifyRequest, reply: import('fastify').FastifyReply, userId: string, client: 'web' | 'native') {
  const s = await createSession(ctx, req, userId);
  if (client === 'web') setSessionCookie(ctx, reply, s.token, s.expiresAt);
  const me = await loadMe(ctx.sql, userId);
  return client === 'native' ? { user: me, token: s.token, expiresAt: s.expiresAt } : { user: me };
}

export default async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql } = ctx;

  // -- First-run setup ------------------------------------------------------
  app.post('/api/auth/setup', { config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    const body = parse(
      z.object({ email: emailSchema, password: passwordSchema, displayName: nameSchema, setupToken: z.string().optional() }),
      req.body,
    );
    if (ctx.config.SETUP_TOKEN && body.setupToken !== ctx.config.SETUP_TOKEN) throw forbidden('Invalid setup token');
    const hash = await hashPassword(body.password);
    const userId = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(727275)`;
      const [n] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE NOT is_demo`;
      if (n!.n > 0) throw conflict('This server has already been set up');
      const [u] = await tx<{ id: string }[]>`
        INSERT INTO users (email, display_name, password_hash, is_admin, email_verified_at, avatar_color)
        VALUES (${body.email}, ${body.displayName}, ${hash}, true, now(), ${pickAvatarColor(body.email)})
        RETURNING id`;
      return u!.id;
    });
    await audit(ctx, req, 'setup.admin_created', { type: 'user', id: userId });
    return startSession(ctx, req, reply, userId, 'web');
  });

  // -- Registration ---------------------------------------------------------
  app.post('/api/auth/register', { config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    const body = parse(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        displayName: nameSchema,
        inviteToken: z.string().max(200).optional(),
        client: z.enum(['web', 'native']).default('web'),
      }),
      req.body,
    );
    if ((await userCount(ctx)) === 0) throw new HttpError(409, 'needs_setup', 'This server needs to be set up first');
    const { registrationPolicy } = await ctx.settings.get();
    const invite = body.inviteToken ? await findInvitation(ctx, body.inviteToken) : null;
    if (body.inviteToken && !invite) throw badRequest('This invitation is invalid or has expired');
    if (registrationPolicy === 'closed') throw forbidden('Registration is disabled on this server. Ask an administrator for an account.');
    if (registrationPolicy === 'invite' && !invite) throw forbidden('Registration requires an invitation link on this server.');

    const existing = await sql`SELECT 1 FROM users WHERE email = ${body.email}`;
    if (existing.length) throw conflict('An account with this email already exists');
    const hash = await hashPassword(body.password);
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, password_hash, avatar_color)
      VALUES (${body.email}, ${body.displayName}, ${hash}, ${pickAvatarColor(body.email)})
      ON CONFLICT (email) DO NOTHING RETURNING id`;
    if (!u) throw conflict('An account with this email already exists');
    if (invite) await acceptInvitation(ctx, body.inviteToken!, u.id);
    await sendVerification(ctx, u.id, body.email);
    await audit(ctx, req, 'user.registered', { type: 'user', id: u.id }, { viaInvite: Boolean(invite) });
    return startSession(ctx, req, reply, u.id, body.client);
  });

  // -- Login ----------------------------------------------------------------
  app.post('/api/auth/login', { config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    const body = parse(
      z.object({ email: emailSchema, password: z.string().max(256), client: z.enum(['web', 'native']).default('web') }),
      req.body,
    );
    const [u] = await sql<{ id: string; password_hash: string | null; disabled_at: Date | null; totp_enabled_at: Date | null; email_verified_at: Date | null }[]>`
      SELECT id, password_hash, disabled_at, totp_enabled_at, email_verified_at FROM users WHERE email = ${body.email}`;
    const ok = await verifyPassword(u?.password_hash ?? (await dummyPasswordHash()), body.password);
    if (!u || !u.password_hash || !ok) {
      await audit(ctx, req, 'auth.login_failed', undefined, { email: body.email });
      throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password');
    }
    if (u.disabled_at) throw forbidden('This account has been disabled');
    if (ctx.config.REQUIRE_EMAIL_VERIFICATION && ctx.mailer.enabled && !u.email_verified_at) {
      throw new HttpError(403, 'email_unverified', 'Please verify your email address before signing in');
    }
    if (u.totp_enabled_at) {
      const s = await createSession(ctx, req, u.id, 'pending_2fa');
      if (body.client === 'web') setSessionCookie(ctx, reply, s.token, s.expiresAt);
      return { twoFactorRequired: true, ...(body.client === 'native' ? { token: s.token } : {}) };
    }
    return startSession(ctx, req, reply, u.id, body.client);
  });

  app.post('/api/auth/2fa', { config: { rateLimit: AUTH_RATE } }, async (req, reply) => {
    const body = parse(z.object({ code: z.string().min(6).max(32) }), req.body);
    const a = req.auth;
    if (!a || a.state !== 'pending_2fa' || !a.sessionId) throw unauthorized('Sign in again');
    const [u] = await sql<{ totp_secret: string; recovery_codes: string[] }[]>`
      SELECT totp_secret, recovery_codes FROM users WHERE id = ${a.userId}`;
    let ok = Boolean(u?.totp_secret && verifyTotp(u.totp_secret, body.code));
    if (!ok && u) {
      const hashed = sha256(body.code.trim().toLowerCase());
      if (u.recovery_codes.includes(hashed)) {
        await sql`UPDATE users SET recovery_codes = array_remove(recovery_codes, ${hashed}) WHERE id = ${a.userId}`;
        await audit(ctx, req, 'auth.recovery_code_used', { type: 'user', id: a.userId });
        ok = true;
      }
    }
    if (!ok) throw new HttpError(401, 'invalid_code', 'That code is not valid');
    await sql`DELETE FROM sessions WHERE id = ${a.sessionId}`;
    return startSession(ctx, req, reply, a.userId, a.via === 'bearer' ? 'native' : 'web');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth?.sessionId) await sql`DELETE FROM sessions WHERE id = ${req.auth.sessionId}`;
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const a = requireUser(req);
    const me = await loadMe(sql, a.userId);
    if (!me) throw unauthorized();
    return me;
  });

  // -- Email verification & password reset ----------------------------------
  app.post('/api/auth/verify-email', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const userId = await consumeToken(ctx, token, 'verify_email');
    if (!userId) throw badRequest('This verification link is invalid or has expired');
    await sql`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${userId}`;
    return { ok: true };
  });

  app.post('/api/auth/resend-verification', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req) => {
    const a = requireUser(req);
    const [u] = await sql<{ email: string; email_verified_at: Date | null }[]>`SELECT email, email_verified_at FROM users WHERE id = ${a.userId}`;
    if (u && !u.email_verified_at) await sendVerification(ctx, a.userId, u.email);
    return { ok: true };
  });

  app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const [u] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email} AND disabled_at IS NULL`;
    if (u) {
      const token = await issueToken(ctx, u.id, 'reset_password', 2);
      await ctx.mailer.send(
        email,
        `Reset your ${ctx.config.INSTANCE_NAME} password`,
        `Someone (hopefully you) asked to reset your password.\n\n${ctx.config.PUBLIC_URL}/reset-password?token=${token}\n\nThe link expires in 2 hours. If you didn't ask for this, ignore this email.`,
      );
    }
    // Same response either way so account existence is not revealed.
    return { ok: true, emailEnabled: ctx.mailer.enabled };
  });

  app.post('/api/auth/reset-password', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: passwordSchema }), req.body);
    let userId = await consumeToken(ctx, body.token, 'reset_password');
    userId ??= await consumeToken(ctx, body.token, 'admin_invite');
    if (!userId) throw badRequest('This link is invalid or has expired');
    const hash = await hashPassword(body.password);
    await sql`UPDATE users SET password_hash = ${hash}, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
              WHERE id = ${userId}`;
    // A password reset signs out every existing session.
    await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
    ctx.hub.disconnectUser(userId);
    await audit(ctx, null, 'auth.password_reset', { type: 'user', id: userId });
    return { ok: true };
  });

  app.post('/api/auth/password', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const a = requireUser(req);
    const body = parse(z.object({ currentPassword: z.string().max(256), newPassword: passwordSchema }), req.body);
    const [u] = await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${a.userId}`;
    if (!u?.password_hash || !(await verifyPassword(u.password_hash, body.currentPassword))) {
      throw new HttpError(401, 'invalid_credentials', 'Current password is incorrect');
    }
    await sql`UPDATE users SET password_hash = ${await hashPassword(body.newPassword)}, updated_at = now() WHERE id = ${a.userId}`;
    await sql`DELETE FROM sessions WHERE user_id = ${a.userId} AND id <> ${a.sessionId}`;
    await audit(ctx, req, 'auth.password_changed', { type: 'user', id: a.userId });
    return { ok: true };
  });

  // -- Sessions -------------------------------------------------------------
  app.get('/api/auth/sessions', async (req) => {
    const a = requireUser(req);
    const rows = await sql<{ id: string; user_agent: string | null; ip: string | null; created_at: Date; last_seen_at: Date }[]>`
      SELECT id, user_agent, host(ip) AS ip, created_at, last_seen_at FROM sessions
      WHERE user_id = ${a.userId} AND state = 'active' AND expires_at > now() ORDER BY last_seen_at DESC`;
    return rows.map((r) => ({
      id: r.id,
      userAgent: r.user_agent,
      ip: r.ip,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      current: r.id === a.sessionId,
    }));
  });

  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (req) => {
    const a = requireUser(req);
    const r = await sql`DELETE FROM sessions WHERE id = ${parse(z.string().uuid(), req.params.id)} AND user_id = ${a.userId} RETURNING id`;
    if (!r.length) throw notFound();
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', async (req) => {
    const a = requireUser(req);
    await sql`DELETE FROM sessions WHERE user_id = ${a.userId} AND id <> ${a.sessionId}`;
    return { ok: true };
  });

  // -- TOTP two-factor ------------------------------------------------------
  app.post('/api/auth/totp/setup', async (req) => {
    const a = requireUser(req);
    const [u] = await sql<{ email: string; totp_enabled_at: Date | null }[]>`SELECT email, totp_enabled_at FROM users WHERE id = ${a.userId}`;
    if (u!.totp_enabled_at) throw conflict('Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await sql`UPDATE users SET totp_secret = ${secret} WHERE id = ${a.userId}`;
    return { secret, uri: totpUri(secret, u!.email, ctx.config.INSTANCE_NAME) };
  });

  app.post('/api/auth/totp/enable', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const a = requireUser(req);
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const [u] = await sql<{ totp_secret: string | null }[]>`SELECT totp_secret FROM users WHERE id = ${a.userId}`;
    if (!u?.totp_secret || !verifyTotp(u.totp_secret, code)) throw badRequest('That code is not valid. Check your device clock and try again.');
    const codes = Array.from({ length: 10 }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8));
    await sql`UPDATE users SET totp_enabled_at = now(), recovery_codes = ${codes.map(sha256)} WHERE id = ${a.userId}`;
    await audit(ctx, req, 'auth.totp_enabled', { type: 'user', id: a.userId });
    return { recoveryCodes: codes };
  });

  app.post('/api/auth/totp/disable', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const a = requireUser(req);
    const { password } = parse(z.object({ password: z.string().max(256) }), req.body);
    const [u] = await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${a.userId}`;
    if (!u?.password_hash || !(await verifyPassword(u.password_hash, password))) {
      throw new HttpError(401, 'invalid_credentials', 'Password is incorrect');
    }
    await sql`UPDATE users SET totp_enabled_at = NULL, totp_secret = NULL, recovery_codes = '{}' WHERE id = ${a.userId}`;
    await audit(ctx, req, 'auth.totp_disabled', { type: 'user', id: a.userId });
    return { ok: true };
  });

}
