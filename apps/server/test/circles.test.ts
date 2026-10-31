import { describe, expect, it } from 'vitest';
import { Client, newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

const fix = (lat: number, lon: number, msAgo = 0, extra: Record<string, unknown> = {}) => ({
  recordedAt: new Date(Date.now() - msAgo).toISOString(),
  lat,
  lon,
  accuracy: 10,
  ...extra,
});

describe('circles, invitations and isolation', () => {
  it('runs the core flow: create circle, invite, join, share, see location', async () => {
    const alice = await newUser(env, 'Alice');
    const circle = (await alice.client.post('/api/circles', { name: 'Family' })).json();
    expect(circle.role).toBe('owner');

    const inv = (await alice.client.post(`/api/circles/${circle.id}/invitations`, { maxUses: 1 })).json();
    expect(inv.url).toContain('/join/');

    // Public preview of the invitation.
    const preview = await new Client(env.app).get(`/api/invitations/${inv.token}`);
    expect(preview.json().circleName).toBe('Family');

    // Bob registers *with* the invitation and is placed in the circle.
    const bob = new Client(env.app);
    const reg = await bob.post('/api/auth/register', {
      email: 'bob@example.com',
      password: 'correct horse battery',
      displayName: 'Bob',
      inviteToken: inv.token,
    });
    expect(reg.statusCode).toBe(200);
    const bobId = reg.json().user.id;
    // Single-use invitation is now spent.
    expect((await new Client(env.app).get(`/api/invitations/${inv.token}`)).statusCode).toBe(404);

    const bobDevice = (await bob.post('/api/devices', { name: 'Bob phone' })).json().device.id;
    const ingest = await bob.post('/api/locations', { deviceId: bobDevice, locations: [fix(44.65, -63.58, 1000, { battery: 77 })] });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().accepted).toBe(1);

    const live = (await alice.client.get(`/api/circles/${circle.id}/live`)).json();
    const bobLive = live.find((m: { id: string }) => m.id === bobId);
    expect(bobLive.location.lat).toBeCloseTo(44.65);
    expect(bobLive.location.battery).toBe(77);

    // Alice got a "joined" notification.
    const notes = (await alice.client.get('/api/notifications')).json();
    expect(notes.items.some((n: { type: string }) => n.type === 'member_joined')).toBe(true);

    // Bob stops sharing with the circle: Alice no longer sees his location or history.
    await bob.patch(`/api/circles/${circle.id}/me`, { sharing: false });
    const live2 = (await alice.client.get(`/api/circles/${circle.id}/live`)).json();
    expect(live2.find((m: { id: string }) => m.id === bobId).location).toBeNull();
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const hist = await alice.client.get(`/api/history/${bobId}/points?from=${from}&to=${to}`);
    expect(hist.statusCode).toBe(404);
  });

  it('never leaks data across circles through API manipulation', async () => {
    const a = await newUser(env, 'Iso A');
    const b = await newUser(env, 'Iso B');
    const outsider = await newUser(env, 'Outsider');
    const circle = (await a.client.post('/api/circles', { name: 'Private' })).json();
    const inv = (await a.client.post(`/api/circles/${circle.id}/invitations`, {})).json();
    await b.client.post(`/api/invitations/${inv.token}/accept`);
    await b.client.post('/api/locations', { deviceId: b.deviceId, locations: [fix(10, 10, 5000)] });
    const place = (await a.client.post('/api/places', { name: 'Secret', lat: 10, lon: 10, circleId: circle.id })).json();

    const o = outsider.client;
    expect((await o.get(`/api/circles/${circle.id}`)).statusCode).toBe(404);
    expect((await o.get(`/api/circles/${circle.id}/live`)).statusCode).toBe(404);
    expect((await o.get(`/api/circles/${circle.id}/invitations`)).statusCode).toBe(404);
    expect((await o.patch(`/api/circles/${circle.id}`, { name: 'pwned' })).statusCode).toBe(404);
    expect((await o.del(`/api/circles/${circle.id}/members/${b.id}`)).statusCode).toBe(404);
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date().toISOString();
    expect((await o.get(`/api/history/${b.id}/points?from=${from}&to=${to}`)).statusCode).toBe(404);
    expect((await o.get(`/api/trips?userId=${b.id}`)).statusCode).toBe(404);
    expect((await o.get(`/api/insights?userId=${b.id}`)).statusCode).toBe(404);
    expect((await o.patch(`/api/places/${place.id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await o.get(`/api/places/${place.id}/alerts`)).statusCode).toBe(404);
    expect((await o.get('/api/places')).json()).toHaveLength(0);
    const live = (await o.get('/api/live')).json();
    expect(live.map((m: { id: string }) => m.id)).toEqual([outsider.id]);
    // Posting locations to someone else's device is rejected.
    expect((await o.post('/api/locations', { deviceId: b.deviceId, locations: [fix(1, 1)] })).statusCode).toBe(404);
    // Places can't be attached to a circle you're not in.
    expect((await o.post('/api/places', { name: 'x', lat: 1, lon: 1, circleId: circle.id })).statusCode).toBe(404);
    // Members can't do admin things.
    expect((await b.client.post(`/api/circles/${circle.id}/invitations`, {})).statusCode).toBe(403);
    expect((await b.client.del(`/api/circles/${circle.id}/members/${a.id}`)).statusCode).toBe(403);
    expect((await b.client.del(`/api/circles/${circle.id}`)).statusCode).toBe(403);
    // Non-admins can't reach admin endpoints.
    expect((await b.client.get('/api/admin/overview')).statusCode).toBe(403);
  });

  it('hides history recorded before someone joined, and while paused', async () => {
    const a = await newUser(env, 'Hist A');
    const b = await newUser(env, 'Hist B');
    // B has old history before joining.
    await b.client.post('/api/locations', { deviceId: b.deviceId, locations: [fix(20, 20, 2 * 3600_000)] });
    const circle = (await a.client.post('/api/circles', { name: 'C' })).json();
    const inv = (await a.client.post(`/api/circles/${circle.id}/invitations`, {})).json();
    await b.client.post(`/api/invitations/${inv.token}/accept`);
    await b.client.post('/api/locations', { deviceId: b.deviceId, locations: [fix(20.001, 20, 0)] });
    // Paused points are private.
    await b.client.post('/api/me/sharing', { paused: true });
    await b.client.post('/api/locations', { deviceId: b.deviceId, locations: [fix(21, 21, -1000)] });
    const from = new Date(Date.now() - 5 * 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const seen = (await a.client.get(`/api/history/${b.id}/points?from=${from}&to=${to}`)).json();
    expect(seen.points).toHaveLength(1);
    const own = (await b.client.get(`/api/history/${b.id}/points?from=${from}&to=${to}`)).json();
    expect(own.points).toHaveLength(3);
    // While paused, the live map shows no location at all.
    const live = (await a.client.get(`/api/circles/${circle.id}/live`)).json();
    expect(live.find((m: { id: string }) => m.id === b.id).location).toBeNull();
  });

  it('lets admins manage roles but protects the owner', async () => {
    const owner = await newUser(env, 'Owner');
    const adm = await newUser(env, 'Adm');
    const mem = await newUser(env, 'Mem');
    const c = (await owner.client.post('/api/circles', { name: 'Roles' })).json();
    for (const u of [adm, mem]) {
      const inv = (await owner.client.post(`/api/circles/${c.id}/invitations`, {})).json();
      await u.client.post(`/api/invitations/${inv.token}/accept`);
    }
    await owner.client.patch(`/api/circles/${c.id}/members/${adm.id}`, { role: 'admin' });
    expect((await adm.client.patch(`/api/circles/${c.id}/members/${owner.id}`, { role: 'member' })).statusCode).toBe(403);
    expect((await adm.client.del(`/api/circles/${c.id}/members/${mem.id}`)).statusCode).toBe(200);
    expect((await owner.client.del(`/api/circles/${c.id}/members/${owner.id}`)).statusCode).toBe(409);
  });
});
