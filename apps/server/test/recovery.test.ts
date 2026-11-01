import { describe, expect, it } from 'vitest';
import { hashPassword } from '../src/lib/crypto.js';
import { recoverAccount } from '../src/services/users.js';
import { Client, newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

describe('server-side account recovery', () => {
  it('sets a new password, signs out every session, and can turn off 2FA and re-enable', async () => {
    const u = await newUser(env, 'Locked');
    expect((await u.client.get('/api/auth/me')).statusCode).toBe(200);
    await env.sql`UPDATE users SET totp_secret = 'X', totp_enabled_at = now(), disabled_at = now() WHERE id = ${u.id}`;

    const r = await recoverAccount(env.sql, u.email.toUpperCase(), await hashPassword('brand new password'), { disable2fa: true, enable: true });
    expect(r).toMatchObject({ id: u.id, was2fa: true, wasDisabled: true });

    // Old sessions are gone; the new password works without a 2FA step.
    expect((await u.client.get('/api/auth/me')).statusCode).toBe(401);
    const fresh = new Client(env.app);
    expect((await fresh.post('/api/auth/login', { email: u.email, password: 'correct horse battery' })).statusCode).toBe(401);
    const ok = await fresh.post('/api/auth/login', { email: u.email, password: 'brand new password' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().twoFactorRequired).toBeFalsy();

    expect(await recoverAccount(env.sql, 'nobody@example.com', 'x')).toBeNull();
  });
});
