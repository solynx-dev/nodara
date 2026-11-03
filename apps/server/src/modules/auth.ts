import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Ctx } from '../context.js';
import {
  audit,
  clearSessionCookie,
  createSession,
  requireUser,
  setSessionCookie,
  SESSION_COOKIE,
} from '../auth.js';
import { dummyPasswordHash, hashPassword, randomToken, safeEqual, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../lib/totp.js';
import { loadMe, pickAvatarColor } from '../services/users.js';
import { emails, notifySecurity } from '../services/emails.js';
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

type Purpose = 'verify_email' | 'reset_password' | 'admin_invite' | 'change_email';

/** Wrong codes allowed per emailed code before it stops working. */
export const MAX_CODE_ATTEMPTS = 5;
const codeHash = (tokenHash: string, code: string) => sha256(`${tokenHash}:${code}`);
const cleanCode = (code: string) => code.replace(/\D/g, '');
const codeSchema = z.string().trim().min(6).max(12);

/**
 * Create a one-time token for an emailed link. With `code`, it also gets a
 * 6-digit code for typing into the app; only the newest code of a kind works,
 * so guesses can't be spread across several emails.
 */
async function issueToken(ctx: Ctx, userId: string, purpose: Purpose, hours: number, opts: { code?: boolean; email?: string } = {}) {
  const token = randomToken();
  const tokenHash = sha256(token);
  const code = opts.code ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
  if (opts.code) {
    await ctx.sql`UPDATE auth_tokens SET used_at = now() WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL`;
  }
  await ctx.sql`
    INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, code_hash, email)
    VALUES (${tokenHash}, ${userId}, ${purpose}, now() + make_interval(hours => ${hours}),
            ${code ? codeHash(tokenHash, code) : null}, ${opts.email ?? null})`;
  return { token, code: code ?? '' };
}

async function consumeToken(ctx: Ctx, token: string, purpose: Purpose) {
  const [row] = await ctx.sql<{ user_id: string; email: string | null }[]>`
    UPDATE auth_tokens SET used_at = now()
    WHERE token_hash = ${sha256(token)} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id, email`;
  return row ?? null;
}

const wrongCode = () => new HttpError(400, 'invalid_code', "That code isn't right. Check the latest email and try again.");

/**
 * Check a typed code against a person's newest open code of a kind. Each try
 * is counted before comparing (so parallel guesses can't skip the limit) and
 * refunded when it's right. With `consume`, a right code is used up.
 */
async function checkCode(ctx: Ctx, userId: string | null, purpose: Purpose, code: string, consume: boolean) {
  if (!userId) throw wrongCode();
  const [t] = await ctx.sql<{ token_hash: string; code_hash: string; attempts: number; email: string | null }[]>`
    UPDATE auth_tokens SET attempts = attempts + 1
    WHERE token_hash = (
      SELECT token_hash FROM auth_tokens
      WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL AND expires_at > now() AND code_hash IS NOT NULL
      ORDER BY created_at DESC LIMIT 1)
    RETURNING token_hash, code_hash, attempts, email`;
  if (!t) throw new HttpError(400, 'code_expired', 'That code has expired. Ask for a new one.');
  if (t.attempts > MAX_CODE_ATTEMPTS) {
    await ctx.sql`UPDATE auth_tokens SET used_at = now() WHERE token_hash = ${t.token_hash}`;
    throw new HttpError(400, 'code_expired', 'Too many wrong codes. Ask for a new one.');
  }
  if (!safeEqual(codeHash(t.token_hash, cleanCode(code)), t.code_hash)) throw wrongCode();
  if (consume) {
    const [used] = await ctx.sql`
      UPDATE auth_tokens SET used_at = now() WHERE token_hash = ${t.token_hash} AND used_at IS NULL RETURNING 1`;
    if (!used) throw new HttpError(400, 'code_expired', 'That code has already been used.');
  } else {
    await ctx.sql`UPDATE auth_tokens SET attempts = attempts - 1 WHERE token_hash = ${t.token_hash}`;
  }
  return { tokenHash: t.token_hash, email: t.email };
}

const userIdByEmail = async (ctx: Ctx, email: string) =>
  (await ctx.sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email} AND disabled_at IS NULL`)[0]?.id ?? null;

export async function sendVerification(ctx: Ctx, userId: string, email: string) {
  const { token, code } = await issueToken(ctx, userId, 'verify_email', 48, { code: true });
  await ctx.mailer.send(email, emails.verify(ctx, `${ctx.config.PUBLIC_URL}/verify-email?token=${token}`, code));
}

/** New accounts must confirm their email first (only possible when the server can send email). */
async function verificationRequired(ctx: Ctx) {
  return ctx.mailer.enabled && (await ctx.settings.get()).requireEmailVerification;
}

export async function createAdminInviteLink(ctx: Ctx, userId: string) {
  const { token } = await issueToken(ctx, userId, 'admin_invite', 7 * 24);
  return `${ctx.config.PUBLIC_URL}/reset-password?token=${token}&welcome=1`;
}

/** Switch an account to a new address; the old one is told and its open links stop working. */
async function applyEmailChange(ctx: Ctx, req: FastifyRequest | null, userId: string, email: string, verified: boolean) {
  const [old] = await ctx.sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`;
  if (!old) throw notFound();
  try {
    await ctx.sql`
      UPDATE users SET email = ${email}, email_verified_at = ${verified ? new Date() : null}, updated_at = now() WHERE id = ${userId}`;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('Another account already uses that email');
    throw err;
  }
  await ctx.sql`
    UPDATE auth_tokens SET used_at = now()
    WHERE user_id = ${userId} AND used_at IS NULL AND purpose IN ('verify_email', 'reset_password', 'change_email')`;
  if (old.email !== email) void ctx.mailer.send(old.email, emails.emailChanged(ctx, email));
  await audit(ctx, req, 'user.email_changed', { type: 'user', id: userId });
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
    // On servers that require it, the account works once the emailed code is entered.
    if (await verificationRequired(ctx)) return { verificationRequired: true, email: body.email };
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
    if (!u.email_verified_at && (await verificationRequired(ctx))) {
      // Send a fresh code unless one went out in the last couple of minutes.
      const [recent] = await sql`
        SELECT 1 FROM auth_tokens WHERE user_id = ${u.id} AND purpose = 'verify_email' AND used_at IS NULL
          AND created_at > now() - interval '2 minutes'`;
      if (!recent) await sendVerification(ctx, u.id, body.email);
      throw new HttpError(403, 'email_unverified', 'Confirm your email to finish signing in. We sent a code to your inbox.');
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
  /**
   * Confirm an email address: with the emailed link's token, with the code
   * while signed in, or with email + code from the sign-in screen (the app
   * then signs in again with the password it still holds).
   */
  app.post('/api/auth/verify-email', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const body = parse(
      z.union([
        z.object({ token: z.string().min(10).max(200) }),
        z.object({ code: codeSchema, email: emailSchema.optional() }),
      ]),
      req.body,
    );
    let userId: string | null;
    if ('token' in body) {
      userId = (await consumeToken(ctx, body.token, 'verify_email'))?.user_id ?? null;
      if (!userId) throw badRequest('This verification link is invalid or has expired');
    } else {
      userId = body.email ? await userIdByEmail(ctx, body.email) : requireUser(req).userId;
      await checkCode(ctx, userId, 'verify_email', body.code, true);
    }
    await sql`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${userId}`;
    return { ok: true, user: req.auth?.userId === userId ? await loadMe(sql, userId!) : undefined };
  });

  /** Send a new verification code: to the signed-in person, or (from the sign-in screen) to an email. */
  app.post('/api/auth/resend-verification', { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req) => {
    const body = parse(z.object({ email: emailSchema.optional() }).default({}), req.body ?? {});
    const userId = body.email ? await userIdByEmail(ctx, body.email) : requireUser(req).userId;
    const [u] = userId
      ? await sql<{ email: string; email_verified_at: Date | null }[]>`SELECT email, email_verified_at FROM users WHERE id = ${userId}`
      : [];
    if (u && !u.email_verified_at) await sendVerification(ctx, userId!, u.email);
    return { ok: true, emailEnabled: ctx.mailer.enabled };
  });

  app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const userId = await userIdByEmail(ctx, email);
    if (userId) {
      const { token, code } = await issueToken(ctx, userId, 'reset_password', 2, { code: true });
      await ctx.mailer.send(email, emails.reset(ctx, `${ctx.config.PUBLIC_URL}/reset-password?token=${token}`, code));
    }
    // Same response either way so account existence is not revealed.
    return { ok: true, emailEnabled: ctx.mailer.enabled };
  });

  /** Check a reset code before asking for the new password (the app's second step). */
  app.post('/api/auth/reset-password/check', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const body = parse(z.object({ email: emailSchema, code: codeSchema }), req.body);
    await checkCode(ctx, await userIdByEmail(ctx, body.email), 'reset_password', body.code, false);
    return { ok: true };
  });

  /** Set a new password with the emailed link's token, or with email + code. */
  app.post('/api/auth/reset-password', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const body = parse(
      z.union([
        z.object({ token: z.string().min(10).max(200), password: passwordSchema }),
        z.object({ email: emailSchema, code: codeSchema, password: passwordSchema }),
      ]),
      req.body,
    );
    let userId: string | null = null;
    let welcome = false;
    if ('token' in body) {
      userId = (await consumeToken(ctx, body.token, 'reset_password'))?.user_id ?? null;
      if (!userId) {
        userId = (await consumeToken(ctx, body.token, 'admin_invite'))?.user_id ?? null;
        welcome = Boolean(userId);
      }
      if (!userId) throw badRequest('This link is invalid or has expired');
    } else {
      userId = await userIdByEmail(ctx, body.email);
      await checkCode(ctx, userId, 'reset_password', body.code, true);
    }
    const hash = await hashPassword(body.password);
    // Getting the email proves the address, so it counts as verified.
    await sql`UPDATE users SET password_hash = ${hash}, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
              WHERE id = ${userId}`;
    // A password reset signs out every existing session.
    await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
    ctx.hub.disconnectUser(userId!);
    await audit(ctx, null, 'auth.password_reset', { type: 'user', id: userId! });
    if (!welcome) await notifySecurity(ctx, userId!, 'Your password was reset', 'The password on your account was just reset, and every device was signed out.');
    return { ok: true };
  });

  // -- Changing the account email ---------------------------------------------
  /**
   * Ask to move the account to a new address. The new address gets a code and
   * a link, the old one a heads-up; nothing changes until it's confirmed. A
   * server without email can't confirm anything, so there the password check
   * is enough and the change happens at once.
   */
  app.post('/api/me/email', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const a = requireUser(req);
    const body = parse(z.object({ email: emailSchema, password: z.string().max(256) }), req.body);
    const [u] = await sql<{ email: string; password_hash: string | null; is_demo: boolean }[]>`
      SELECT email, password_hash, is_demo FROM users WHERE id = ${a.userId}`;
    if (!u) throw unauthorized();
    if (u.is_demo) throw forbidden("Demo accounts can't change their email");
    if (!u.password_hash || !(await verifyPassword(u.password_hash, body.password))) {
      throw new HttpError(401, 'invalid_credentials', 'Password is incorrect');
    }
    if (body.email === u.email) throw badRequest("That's already your email");
    if ((await sql`SELECT 1 FROM users WHERE email = ${body.email}`).length) throw conflict('Another account already uses that email');
    if (!ctx.mailer.enabled) {
      await applyEmailChange(ctx, req, a.userId, body.email, false);
      return { changed: true, user: await loadMe(sql, a.userId) };
    }
    const { token, code } = await issueToken(ctx, a.userId, 'change_email', 24, { code: true, email: body.email });
    await ctx.mailer.send(body.email, emails.changeEmail(ctx, `${ctx.config.PUBLIC_URL}/confirm-email?token=${token}`, code, u.email));
    void ctx.mailer.send(u.email, emails.changeRequested(ctx, body.email));
    await audit(ctx, req, 'user.email_change_requested', { type: 'user', id: a.userId });
    return { changed: false, user: await loadMe(sql, a.userId) };
  });

  /** Confirm a change with the code sent to the new address. */
  app.post('/api/me/email/confirm', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const a = requireUser(req);
    const { code } = parse(z.object({ code: codeSchema }), req.body);
    const t = await checkCode(ctx, a.userId, 'change_email', code, true);
    await applyEmailChange(ctx, req, a.userId, t.email!, true);
    return { user: await loadMe(sql, a.userId) };
  });

  /** Confirm a change from the link in the email (works without being signed in). */
  app.post('/api/auth/confirm-email', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const t = await consumeToken(ctx, token, 'change_email');
    if (!t?.email) throw badRequest('This link is invalid or has expired');
    await applyEmailChange(ctx, req, t.user_id, t.email, true);
    return { ok: true, email: t.email };
  });

  app.delete('/api/me/email/pending', async (req) => {
    const a = requireUser(req);
    await sql`UPDATE auth_tokens SET used_at = now() WHERE user_id = ${a.userId} AND purpose = 'change_email' AND used_at IS NULL`;
    return { user: await loadMe(sql, a.userId) };
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
    await notifySecurity(ctx, a.userId, 'Your password was changed', 'The password on your account was just changed, and your other devices were signed out.');
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
    const uri = totpUri(secret, u!.email, ctx.config.INSTANCE_NAME);
    // A ready-made QR (PNG data URL) for apps that set up an authenticator on another device.
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 360 }) };
  });

  app.post('/api/auth/totp/enable', { config: { rateLimit: AUTH_RATE } }, async (req) => {
    const a = requireUser(req);
    const { code } = parse(z.object({ code: z.string() }), req.body);
    const [u] = await sql<{ totp_secret: string | null }[]>`SELECT totp_secret FROM users WHERE id = ${a.userId}`;
    if (!u?.totp_secret || !verifyTotp(u.totp_secret, code)) throw badRequest('That code is not valid. Check your device clock and try again.');
    const codes = Array.from({ length: 10 }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8));
    await sql`UPDATE users SET totp_enabled_at = now(), recovery_codes = ${codes.map(sha256)} WHERE id = ${a.userId}`;
    await audit(ctx, req, 'auth.totp_enabled', { type: 'user', id: a.userId });
    await notifySecurity(ctx, a.userId, 'Two-step verification is on', 'Signing in with your password now also needs a code from your authenticator app.');
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
    await notifySecurity(ctx, a.userId, 'Two-step verification was turned off', 'Signing in now only needs your password (or a passkey).');
    return { ok: true };
  });

}
