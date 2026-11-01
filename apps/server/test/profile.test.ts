import { describe, expect, it } from 'vitest';
import { newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function family() {
  const a = await newUser(env, 'Ann');
  const b = await newUser(env, 'Ben');
  const outsider = await newUser(env, 'Olga');
  const circle = (await a.client.post('/api/circles', { name: 'Home' })).json();
  const inv = (await a.client.post(`/api/circles/${circle.id}/invitations`, { maxUses: 1 })).json();
  await b.client.post(`/api/invitations/${inv.token}/accept`);
  return { a, b, outsider, circle };
}

describe('profile photos', () => {
  it('uploads, serves to circle-mates only, and removes a photo', async () => {
    const { a, b, outsider } = await family();
    const me = await a.client.put('/api/me/avatar', { image: `data:image/png;base64,${PNG}` });
    expect(me.statusCode).toBe(200);
    const url = me.json().avatarUrl as string;
    expect(url).toMatch(new RegExp(`^/api/users/${a.id}/avatar\\?v=`));

    // Shown to members of the same circle, with safe headers.
    const img = await b.client.get(url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);
    const live = (await b.client.get('/api/live')).json();
    expect(live.find((m: { id: string }) => m.id === a.id).avatarUrl).toBe(url);

    // Not to strangers.
    expect((await outsider.client.get(url)).statusCode).toBe(404);

    await a.client.del('/api/me/avatar');
    expect((await a.client.get('/api/auth/me')).json().avatarUrl).toBeNull();
    expect((await b.client.get(url)).statusCode).toBe(404);
  });

  it('refuses things that are not images', async () => {
    const u = await newUser(env, 'Sneaky');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    const r = await u.client.put('/api/me/avatar', { image: svg });
    expect(r.statusCode).toBe(400);
  });
});

describe('time at current location', () => {
  it('reports when someone arrived at a saved place', async () => {
    const { a, b, circle } = await family();
    await a.client.post('/api/places', { name: 'Cottage', lat: 45, lon: -63, radiusM: 150, circleId: circle.id });
    // Out, then in.
    await a.client.post('/api/locations', {
      deviceId: a.deviceId,
      locations: [
        { recordedAt: new Date(Date.now() - 50 * 60_000).toISOString(), lat: 45.05, lon: -63, accuracy: 10 },
        { recordedAt: new Date(Date.now() - 40 * 60_000).toISOString(), lat: 45.0001, lon: -63, accuracy: 10 },
        { recordedAt: new Date(Date.now() - 1000).toISOString(), lat: 45.0001, lon: -63, accuracy: 10 },
      ],
    });
    const ann = (await b.client.get('/api/live')).json().find((m: { id: string }) => m.id === a.id);
    expect(ann.currentPlace?.name).toBe('Cottage');
    expect(ann.stay).not.toBeNull();
    // Ben joined after Ann arrived, so he only learns "at least since he could see her".
    const since = Date.parse(ann.stay.since);
    expect(Date.now() - since).toBeLessThan(45 * 60_000);
    const mine = (await a.client.get('/api/live')).json().find((m: { id: string }) => m.id === a.id);
    expect(mine.stay.atLeast).toBe(false);
  });
});
