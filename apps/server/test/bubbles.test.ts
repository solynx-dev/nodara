import { describe, expect, it } from 'vitest';
import { haversine } from '@nodara/shared';
import { expireBubbles, randomCentre } from '../src/services/bubbles.js';
import { newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();

async function family() {
  const a = await newUser(env, 'Ava');
  const b = await newUser(env, 'Bo');
  const circle = (await a.client.post('/api/circles', { name: 'Home' })).json();
  const inv = (await a.client.post(`/api/circles/${circle.id}/invitations`, { maxUses: 1 })).json();
  await b.client.post(`/api/invitations/${inv.token}/accept`);
  return { a, b, circle };
}

type Person = Awaited<ReturnType<typeof newUser>>;
const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const post = (p: Person, lat: number, lon: number, minAgo = 0, extra: Record<string, unknown> = {}) =>
  p.client.post('/api/locations', { deviceId: p.deviceId, locations: [{ recordedAt: at(minAgo), lat, lon, accuracy: 10, battery: 64, ...extra }] });
const liveOf = async (viewer: Person, who: Person) =>
  ((await viewer.client.get('/api/live')).json() as { id: string; location: unknown; bubble: Record<string, unknown> | null; currentPlace: unknown; inTrip: boolean }[]).find(
    (m) => m.id === who.id,
  )!;
const notes = async (p: Person) => (await p.client.get('/api/notifications')).json().items as { type: string; title: string }[];

describe('bubbles', () => {
  it('shows circles a general area instead of the exact location, and hides that time from history', async () => {
    const { a, b } = await family();
    await post(a, 45.1, -64.8, 1);
    const start = await a.client.post('/api/bubble', { radiusM: 5000, hours: 2 });
    expect(start.statusCode).toBe(200);
    const bubble = start.json().bubble;
    expect(bubble).toMatchObject({ radiusM: 5000 });
    // The centre is near them, but deliberately not on them.
    expect(haversine(45.1, -64.8, bubble.lat, bubble.lon)).toBeLessThanOrEqual(2000 + 1);

    await post(a, 45.105, -64.79, 0);
    const seen = await liveOf(b, a);
    expect(seen.location).toBeNull();
    expect(seen.bubble).toMatchObject({ id: bubble.id, radiusM: 5000, battery: 64 });
    expect(seen.currentPlace).toBeNull();
    // They still see themselves exactly.
    const self = await liveOf(a, a);
    expect(self.location).not.toBeNull();
    expect(self.bubble).toMatchObject({ id: bubble.id });
    expect((await notes(b)).some((n) => n.type === 'bubble' && /started a bubble/.test(n.title))).toBe(true);

    // History during the bubble is hidden from the circle, not from the person.
    const range = `from=${encodeURIComponent(at(60))}&to=${encodeURIComponent(at(-1))}`;
    const theirs = (await b.client.get(`/api/history/${a.id}/points?${range}`)).json();
    expect(theirs.total).toBe(1);
    const mine = (await a.client.get(`/api/history/${a.id}/points?${range}`)).json();
    expect(mine.total).toBe(2);

    // Ending it shows the location again, but the bubble's time stays hidden.
    const end = await a.client.del('/api/bubble');
    expect(end.json().bubble).toBeNull();
    expect((await liveOf(b, a)).location).not.toBeNull();
    expect((await b.client.get(`/api/history/${a.id}/points?${range}`)).json().total).toBe(1);
  });

  it('ends when they leave the area or the time is up, and tells them', async () => {
    const { a, b } = await family();
    await post(a, 46, -64, 1);
    await a.client.post('/api/bubble', { radiusM: 1000, hours: 1 });
    await post(a, 46.2, -64, 0); // ~22 km away
    expect((await a.client.get('/api/bubble')).json().bubble).toBeNull();
    expect((await liveOf(b, a)).location).not.toBeNull();
    expect((await notes(a)).some((n) => n.type === 'bubble_ended' && /left your bubble/i.test(n.title))).toBe(true);

    await a.client.post('/api/bubble', { radiusM: 1000, hours: 1 });
    await env.sql`UPDATE bubbles SET expires_at = now() - interval '1 second' WHERE user_id = ${a.id} AND ended_at IS NULL`;
    // Already gone for viewers, even before the job runs.
    expect((await liveOf(b, a)).location).not.toBeNull();
    expect(await expireBubbles(env.ctx)).toBe(1);
    const [row] = await env.sql<{ end_reason: string }[]>`SELECT end_reason FROM bubbles WHERE user_id = ${a.id} ORDER BY started_at DESC LIMIT 1`;
    expect(row!.end_reason).toBe('expired');
  });

  it('lets circle owners and admins turn bubbles off', async () => {
    const { a, b, circle } = await family();
    await post(b, 44, -63, 1);
    await b.client.post('/api/bubble', { radiusM: 3000, hours: 2 });
    expect((await liveOf(a, b)).location).toBeNull();

    // Members can't change it; the owner can.
    expect((await b.client.patch(`/api/circles/${circle.id}`, { settings: { bubblesAllowed: false } })).statusCode).toBe(403);
    const off = await a.client.patch(`/api/circles/${circle.id}`, { settings: { bubblesAllowed: false } });
    expect(off.json().settings.bubblesAllowed).toBe(false);
    expect((await liveOf(a, b)).location).not.toBeNull();
    expect((await notes(b)).some((n) => /turned off in Home/.test(n.title))).toBe(true);

    // No circle allows them now, so a new bubble is refused.
    const again = await b.client.post('/api/bubble', { radiusM: 3000, hours: 2 });
    expect(again.statusCode).toBe(400);
    expect((await b.client.get('/api/bubble')).json().circles).toEqual([expect.objectContaining({ id: circle.id, allowed: false })]);
  });

  it('keeps place arrivals inside a bubble from the circle', async () => {
    const { a, b, circle } = await family();
    const place = (await b.client.post('/api/places', { name: 'Gym', lat: 47, lon: -65, radiusM: 150, circleId: circle.id })).json();
    await b.client.put(`/api/places/${place.id}/alerts`, { alerts: [{ memberId: a.id, onArrive: true, onDepart: true }] });
    await post(a, 47.01, -65, 1);
    await a.client.post('/api/bubble', { radiusM: 5000, hours: 1 });
    await post(a, 47, -65, 0);

    expect((await notes(b)).some((n) => n.type === 'arrival')).toBe(false);
    const places = (await b.client.get('/api/places')).json() as { id: string; membersInside: string[] }[];
    expect(places.find((p) => p.id === place.id)!.membersInside).not.toContain(a.id);
    const events = (await b.client.get(`/api/place-events?userId=${a.id}`)).json();
    expect(events).toEqual([]);
    expect((await a.client.get(`/api/place-events?userId=${a.id}`)).json()).toHaveLength(1);
  });

  it('picks centres within 40% of the radius', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCentre(45, -64, 10_000);
      expect(haversine(45, -64, c.lat, c.lon)).toBeLessThanOrEqual(4_001);
    }
  });
});
