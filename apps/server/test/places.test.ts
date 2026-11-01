import { describe, expect, it } from 'vitest';
import { newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

describe('editing places and choosing alerts', () => {
  it('lets circle admins edit a member’s place, and saves per-person arrive/leave alerts', async () => {
    const admin = await newUser(env, 'Admin');
    const kid = await newUser(env, 'Kid');
    const partner = await newUser(env, 'Partner');
    const circle = (await admin.client.post('/api/circles', { name: 'Home' })).json();
    for (const u of [kid, partner]) {
      const inv = (await admin.client.post(`/api/circles/${circle.id}/invitations`, { maxUses: 1 })).json();
      await u.client.post(`/api/invitations/${inv.token}/accept`);
    }
    const place = (await kid.client.post('/api/places', { name: 'School', lat: 46.1, lon: -64.8, radiusM: 120, circleId: circle.id })).json();

    // The admin may edit it (and the list says so); the partner, a plain member, may not.
    const list = (await admin.client.get('/api/places')).json();
    expect(list.find((p: { id: string }) => p.id === place.id).canEdit).toBe(true);
    expect((await partner.client.get('/api/places')).json().find((p: { id: string }) => p.id === place.id).canEdit).toBe(false);
    const moved = await admin.client.patch(`/api/places/${place.id}`, { lat: 46.1005, lon: -64.8005, radiusM: 260, name: 'High school' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ name: 'High school', radiusM: 260 });
    expect((await partner.client.patch(`/api/places/${place.id}`, { radiusM: 999 })).statusCode).toBe(403);

    // Alerts: arrivals for the kid only, departures for the partner only.
    const alerts = [
      { memberId: kid.id, onArrive: true, onDepart: false },
      { memberId: partner.id, onArrive: false, onDepart: true },
    ];
    expect((await admin.client.put(`/api/places/${place.id}/alerts`, { alerts })).statusCode).toBe(200);
    const saved = (await admin.client.get(`/api/places/${place.id}/alerts`)).json();
    expect(saved).toEqual(expect.arrayContaining(alerts));
    expect(saved).toHaveLength(2);
  });
});
