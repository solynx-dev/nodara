import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestEnv } from './helpers.js';
import { totp } from '../src/lib/totp.js';

const env = useTestEnv();

describe('setup & authentication', () => {
  it('first user becomes administrator through setup; setup is then closed', async () => {
    const admin = await newUser(env, 'Admin');
    const me = await admin.client.get('/api/auth/me');
    expect(me.json().isAdmin).toBe(true);
    const again = await new Client(env.app).post('/api/auth/setup', {
      email: 'x@example.com',
      password: 'another password',
      displayName: 'X',
    });
    expect(again.statusCode).toBe(409);
  });

  it('rejects wrong passwords without revealing whether the account exists', async () => {
    const u = await newUser(env, 'Pat');
    const c = new Client(env.app);
    const wrong = await c.post('/api/auth/login', { email: u.email, password: 'nope nope nope' });
    const missing = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'nope nope nope' });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json().message).toBe(missing.json().message);
    const ok = await c.post('/api/auth/login', { email: u.email, password: 'correct horse battery' });
    expect(ok.statusCode).toBe(200);
  });

  it('enforces the CSRF header on cookie-authenticated writes', async () => {
    const u = await newUser(env, 'Csrf');
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/circles',
      payload: { name: 'X' },
      headers: { cookie: u.client.cookie },
    });
    expect(res.statusCode).toBe(403);
    const cross = await u.client.post('/api/circles', { name: 'X' }, { origin: 'https://evil.example' });
    expect(cross.statusCode).toBe(403);
  });

  it('respects the registration policy', async () => {
    await newUser(env, 'Policy');
    await env.ctx.settings.update({ registrationPolicy: 'invite' });
    const c = new Client(env.app);
    const r = await c.post('/api/auth/register', { email: 'new@example.com', password: 'long enough pw', displayName: 'N' });
    expect(r.statusCode).toBe(403);
    await env.ctx.settings.update({ registrationPolicy: 'open' });
  });

  it('supports TOTP two-factor login with recovery codes', async () => {
    const u = await newUser(env, 'Totp');
    const setup = (await u.client.post('/api/auth/totp/setup')).json();
    const enable = await u.client.post('/api/auth/totp/enable', { code: totp(setup.secret) });
    expect(enable.statusCode).toBe(200);
    const recovery = enable.json().recoveryCodes as string[];
    expect(recovery).toHaveLength(10);

    const c = new Client(env.app);
    const step1 = await c.post('/api/auth/login', { email: u.email, password: 'correct horse battery' });
    expect(step1.json().twoFactorRequired).toBe(true);
    // A pending session cannot access the API.
    expect((await c.get('/api/circles')).statusCode).toBe(401);
    expect((await c.post('/api/auth/2fa', { code: '000000' })).statusCode).toBe(401);
    const step2 = await c.post('/api/auth/2fa', { code: totp(setup.secret) });
    expect(step2.statusCode).toBe(200);
    expect((await c.get('/api/circles')).statusCode).toBe(200);

    const c2 = new Client(env.app);
    await c2.post('/api/auth/login', { email: u.email, password: 'correct horse battery' });
    expect((await c2.post('/api/auth/2fa', { code: recovery[0] })).statusCode).toBe(200);
    // Recovery codes are single-use.
    const c3 = new Client(env.app);
    await c3.post('/api/auth/login', { email: u.email, password: 'correct horse battery' });
    expect((await c3.post('/api/auth/2fa', { code: recovery[0] })).statusCode).toBe(401);
  });

  it('password reset via emailed token signs out other sessions', async () => {
    const u = await newUser(env, 'Reset');
    await new Client(env.app).post('/api/auth/forgot-password', { email: u.email });
    const mail = env.ctx.mailer.outbox.findLast((m) => m.to === u.email)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    const r = await new Client(env.app).post('/api/auth/reset-password', { token, password: 'a brand new password' });
    expect(r.statusCode).toBe(200);
    expect((await u.client.get('/api/auth/me')).statusCode).toBe(401);
    // Tokens are single use.
    expect((await new Client(env.app).post('/api/auth/reset-password', { token, password: 'another new password' })).statusCode).toBe(400);
  });

  it('issues bearer tokens for native clients', async () => {
    const u = await newUser(env, 'Native');
    const c = new Client(env.app);
    const r = await c.post('/api/auth/login', { email: u.email, password: 'correct horse battery', client: 'native' });
    const token = r.json().token as string;
    expect(token).toMatch(/^nds_/);
    const me = await env.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
  });

  it('lets users delete their account', async () => {
    const u = await newUser(env, 'Leaver');
    const r = await u.client.del('/api/me', { password: 'correct horse battery', confirm: 'DELETE' });
    expect(r.statusCode).toBe(200);
    const [row] = await env.sql`SELECT 1 FROM users WHERE id = ${u.id}`;
    expect(row).toBeUndefined();
  });
});
