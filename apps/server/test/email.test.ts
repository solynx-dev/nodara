import { afterEach, describe, expect, it } from 'vitest';
import { Client, newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

/** Pretend SMTP is configured (messages still only land in the outbox). */
function withEmail(on: boolean) {
  Object.defineProperty(env.ctx.mailer, 'enabled', { value: on, configurable: true });
}
afterEach(async () => {
  withEmail(false);
  await env.ctx.settings.update({ requireEmailVerification: false });
});

const lastMail = (to: string) => env.ctx.mailer.outbox.findLast((m) => m.to === to)!;
const codeIn = (text: string) => /Your code: (\d{6})/.exec(text)![1]!;

describe('password reset with an emailed code', () => {
  it('checks the code, sets the password, signs out everywhere and sends a notice', async () => {
    const u = await newUser(env, 'Coder');
    const anon = new Client(env.app);
    expect((await anon.post('/api/auth/forgot-password', { email: u.email })).statusCode).toBe(200);
    const mail = lastMail(u.email);
    expect(mail.text).toMatch(/reset-password\?token=/);
    const code = codeIn(mail.text);

    // A wrong code is refused; the right one checks out without being used up.
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await anon.post('/api/auth/reset-password/check', { email: u.email, code: wrong })).json().error).toBe('invalid_code');
    expect((await anon.post('/api/auth/reset-password/check', { email: u.email, code })).statusCode).toBe(200);
    // Unknown emails look the same as wrong codes.
    expect((await anon.post('/api/auth/reset-password/check', { email: 'ghost@example.com', code })).json().error).toBe('invalid_code');

    const r = await anon.post('/api/auth/reset-password', { email: u.email, code: `${code.slice(0, 3)} ${code.slice(3)}`, password: 'fresh password 123' });
    expect(r.statusCode).toBe(200);
    expect((await u.client.get('/api/auth/me')).statusCode).toBe(401);
    expect(lastMail(u.email).subject).toMatch(/password was reset/i);
    expect((await new Client(env.app).post('/api/auth/login', { email: u.email, password: 'fresh password 123' })).statusCode).toBe(200);
    // Used up.
    expect((await anon.post('/api/auth/reset-password', { email: u.email, code, password: 'another password 1' })).statusCode).toBe(400);
  });

  it('stops accepting a code after too many wrong guesses, and only the newest code works', async () => {
    const u = await newUser(env, 'Guesser');
    const anon = new Client(env.app);
    await anon.post('/api/auth/forgot-password', { email: u.email });
    const first = codeIn(lastMail(u.email).text);
    await anon.post('/api/auth/forgot-password', { email: u.email });
    const code = codeIn(lastMail(u.email).text);
    if (first !== code) {
      expect((await anon.post('/api/auth/reset-password/check', { email: u.email, code: first })).statusCode).toBe(400);
    }
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await anon.post('/api/auth/reset-password/check', { email: u.email, code: wrong });
    const r = await anon.post('/api/auth/reset-password/check', { email: u.email, code });
    expect(r.json().error).toBe('code_expired');
  });
});

describe('email verification', () => {
  it('verifies with a code while signed in', async () => {
    const u = await newUser(env, 'Verifier');
    withEmail(true);
    await u.client.post('/api/auth/resend-verification');
    const code = codeIn(lastMail(u.email).text);
    const r = await u.client.post('/api/auth/verify-email', { code });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.emailVerified).toBe(true);
  });

  it('when required, holds new accounts until the emailed code is entered', async () => {
    await newUser(env, 'Admin first');
    withEmail(true);
    await env.ctx.settings.update({ requireEmailVerification: true });
    const c = new Client(env.app);
    const email = 'gated@example.com';
    const reg = await c.post('/api/auth/register', { email, password: 'correct horse battery', displayName: 'Gated', client: 'native' });
    expect(reg.json()).toMatchObject({ verificationRequired: true });
    expect(reg.json().token).toBeUndefined();

    const login = await c.post('/api/auth/login', { email, password: 'correct horse battery', client: 'native' });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toBe('email_unverified');

    const code = codeIn(lastMail(email).text);
    expect((await c.post('/api/auth/verify-email', { email, code })).statusCode).toBe(200);
    const ok = await c.post('/api/auth/login', { email, password: 'correct horse battery', client: 'native' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toMatch(/^nds_/);
  });
});

describe('changing the account email', () => {
  it('asks the new address to confirm, warns the old one, then switches', async () => {
    const u = await newUser(env, 'Mover');
    withEmail(true);
    const bad = await u.client.post('/api/me/email', { email: 'moved@example.com', password: 'wrong password' });
    expect(bad.statusCode).toBe(401);

    const r = await u.client.post('/api/me/email', { email: 'Moved@Example.com', password: 'correct horse battery' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ changed: false, user: { email: u.email, pendingEmail: 'moved@example.com' } });
    expect(lastMail(u.email).subject).toMatch(/email change requested/i);
    const code = codeIn(lastMail('moved@example.com').text);

    const done = await u.client.post('/api/me/email/confirm', { code });
    expect(done.statusCode).toBe(200);
    expect(done.json().user).toMatchObject({ email: 'moved@example.com', emailVerified: true, pendingEmail: null });
    expect(lastMail(u.email).subject).toMatch(/email was changed/i);
    expect((await new Client(env.app).post('/api/auth/login', { email: 'moved@example.com', password: 'correct horse battery' })).statusCode).toBe(200);
  });

  it('confirms from the emailed link, refuses taken addresses, and can be cancelled', async () => {
    const a = await newUser(env, 'Linker');
    const b = await newUser(env, 'Taken');
    withEmail(true);
    expect((await a.client.post('/api/me/email', { email: b.email, password: 'correct horse battery' })).statusCode).toBe(409);

    await a.client.post('/api/me/email', { email: 'linked@example.com', password: 'correct horse battery' });
    const cancel = await a.client.del('/api/me/email/pending');
    expect(cancel.json().user.pendingEmail).toBeNull();

    await a.client.post('/api/me/email', { email: 'linked@example.com', password: 'correct horse battery' });
    const token = /confirm-email\?token=([\w-]+)/.exec(lastMail('linked@example.com').text)![1]!;
    const r = await new Client(env.app).post('/api/auth/confirm-email', { token });
    expect(r.json()).toMatchObject({ ok: true, email: 'linked@example.com' });
    expect((await a.client.get('/api/auth/me')).json().email).toBe('linked@example.com');
  });

  it('changes at once on servers without email', async () => {
    const u = await newUser(env, 'Offline');
    const r = await u.client.post('/api/me/email', { email: 'offline-new@example.com', password: 'correct horse battery' });
    expect(r.json()).toMatchObject({ changed: true, user: { email: 'offline-new@example.com', emailVerified: false } });
  });
});

describe('two-step setup and passkeys from the app', () => {
  it('returns a QR code for the authenticator and serves the passkey association file', async () => {
    const u = await newUser(env, 'Qr');
    const r = await u.client.post('/api/auth/totp/setup');
    expect(r.json().qr).toMatch(/^data:image\/png;base64,/);
    const aasa = await new Client(env.app).get('/.well-known/apple-app-site-association');
    expect(aasa.statusCode).toBe(200);
    expect(aasa.json()).toEqual({ webcredentials: { apps: ['2S4C3A5ZF2.ca.nodara.app'] } });
  });
});
