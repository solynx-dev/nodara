import { describe, expect, it } from 'vitest';
import { Client, useTestEnv } from './helpers.js';

const env = useTestEnv();

describe('privacy policy page', () => {
  it('is public, static HTML rendered from PRIVACY.md', async () => {
    const c = new Client(env.app);
    const r = await c.get('/privacy-policy');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('<title>Nodara Privacy Policy</title>');
    expect(r.body).toContain('id="4-optional-anonymous-usage-analytics"');
    expect(r.body).toContain('Effective Date:</strong> November 1, 2026<br>');
    expect(r.body).toContain('href="https://github.com/solynx-dev/" rel="noopener noreferrer"');
    expect(r.body).not.toMatch(/<script/i);

    const short = await c.get('/privacy');
    expect(short.statusCode).toBe(301);
    expect(short.headers.location).toBe('/privacy-policy');
  });
});
