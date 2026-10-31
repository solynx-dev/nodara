import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import type { Ctx } from '../context.js';
import { audit, createSession, requireUser, setSessionCookie } from '../auth.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { loadMe } from '../services/users.js';

/**
 * Optional passkey (WebAuthn) sign-in. Works with platform authenticators
 * (Face ID, Touch ID, Windows Hello, Android) and security keys. Requires the
 * server to be reached through PUBLIC_URL over HTTPS (or http://localhost).
 */
export default async function passkeyRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql, config } = ctx;
  const rp = { rpName: config.INSTANCE_NAME, rpID: config.rpId, origin: config.origin };

  async function storeChallenge(challenge: string, purpose: 'register' | 'login', userId: string | null) {
    await sql`DELETE FROM webauthn_challenges WHERE expires_at < now()`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO webauthn_challenges (user_id, challenge, purpose, expires_at)
      VALUES (${userId}, ${challenge}, ${purpose}, now() + interval '5 minutes') RETURNING id`;
    return row!.id;
  }

  async function takeChallenge(id: string, purpose: 'register' | 'login', userId: string | null) {
    const [row] = await sql<{ challenge: string; user_id: string | null }[]>`
      DELETE FROM webauthn_challenges WHERE id = ${id} AND purpose = ${purpose} AND expires_at > now()
      RETURNING challenge, user_id`;
    if (!row || (userId && row.user_id !== userId)) throw badRequest('Passkey challenge expired, please try again');
    return row.challenge;
  }

  app.get('/api/auth/passkeys', async (req) => {
    const a = requireUser(req);
    const rows = await sql<{ id: string; name: string; created_at: Date; last_used_at: Date | null }[]>`
      SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ${a.userId} ORDER BY created_at`;
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  });

  app.post('/api/auth/passkeys/register/options', async (req) => {
    const a = requireUser(req);
    const [u] = await sql<{ email: string; display_name: string }[]>`SELECT email, display_name FROM users WHERE id = ${a.userId}`;
    const existing = await sql<{ id: string; transports: string[] }[]>`SELECT id, transports FROM passkeys WHERE user_id = ${a.userId}`;
    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName: u!.email,
      userDisplayName: u!.display_name,
      userID: new TextEncoder().encode(a.userId),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    const challengeId = await storeChallenge(options.challenge, 'register', a.userId);
    return { challengeId, options };
  });

  app.post('/api/auth/passkeys/register/verify', async (req) => {
    const a = requireUser(req);
    const body = parse(
      z.object({ challengeId: z.string().uuid(), name: z.string().trim().min(1).max(60).default('Passkey'), response: z.any() }),
      req.body,
    );
    const expectedChallenge = await takeChallenge(body.challengeId, 'register', a.userId);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
      });
    } catch (err) {
      throw badRequest(`Passkey registration failed: ${(err as Error).message}`);
    }
    if (!verification.verified || !verification.registrationInfo) throw badRequest('Passkey could not be verified');
    const { credential } = verification.registrationInfo;
    await sql`
      INSERT INTO passkeys (id, user_id, public_key, counter, transports, name)
      VALUES (${credential.id}, ${a.userId}, ${Buffer.from(credential.publicKey)}, ${credential.counter},
              ${credential.transports ?? []}, ${body.name})`;
    await audit(ctx, req, 'auth.passkey_added', { type: 'user', id: a.userId });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/auth/passkeys/:id', async (req) => {
    const a = requireUser(req);
    const r = await sql`DELETE FROM passkeys WHERE id = ${req.params.id} AND user_id = ${a.userId} RETURNING id`;
    if (!r.length) throw notFound();
    await audit(ctx, req, 'auth.passkey_removed', { type: 'user', id: a.userId });
    return { ok: true };
  });

  app.post('/api/auth/passkeys/login/options', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async () => {
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'preferred' });
    const challengeId = await storeChallenge(options.challenge, 'login', null);
    return { challengeId, options };
  });

  app.post('/api/auth/passkeys/login/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ challengeId: z.string().uuid(), response: z.object({ id: z.string() }).passthrough() }), req.body);
    const expectedChallenge = await takeChallenge(body.challengeId, 'login', null);
    const [pk] = await sql<{ id: string; user_id: string; public_key: Buffer; counter: number; transports: string[] }[]>`
      SELECT p.id, p.user_id, p.public_key, p.counter, p.transports FROM passkeys p
      JOIN users u ON u.id = p.user_id WHERE p.id = ${body.response.id} AND u.disabled_at IS NULL`;
    if (!pk) throw new HttpError(401, 'invalid_credentials', 'This passkey is not registered on this server');
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response as never,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        credential: {
          id: pk.id,
          publicKey: new Uint8Array(pk.public_key),
          counter: pk.counter,
          transports: pk.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (err) {
      throw new HttpError(401, 'invalid_credentials', `Passkey sign-in failed: ${(err as Error).message}`);
    }
    if (!verification.verified) throw new HttpError(401, 'invalid_credentials', 'Passkey sign-in failed');
    await sql`UPDATE passkeys SET counter = ${verification.authenticationInfo.newCounter}, last_used_at = now() WHERE id = ${pk.id}`;
    // A passkey is a strong, phishing-resistant factor on its own; no TOTP prompt.
    const s = await createSession(ctx, req, pk.user_id);
    setSessionCookie(ctx, reply, s.token, s.expiresAt);
    return { user: await loadMe(sql, pk.user_id) };
  });
}
