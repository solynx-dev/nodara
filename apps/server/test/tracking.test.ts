import { describe, expect, it } from 'vitest';
import { newUser, useTestEnv } from './helpers.js';
import { processDeviceTrips } from '../src/services/trips.js';
import { runRetention } from '../src/services/jobs.js';

const env = useTestEnv();

/** Build a drive: rest, move along a line, rest. Times relative to `end`. */
function journey(from: [number, number], to: [number, number], end: number) {
  const fixes = [];
  const iv = 15_000;
  let t = end - 50 * 60_000;
  for (let i = 0; i < 40; i++, t += iv) fixes.push({ recordedAt: new Date(t).toISOString(), lat: from[0], lon: from[1], accuracy: 10, speed: 0 });
  for (let i = 0; i <= 48; i++, t += iv) {
    const f = i / 48;
    fixes.push({
      recordedAt: new Date(t).toISOString(),
      lat: from[0] + (to[0] - from[0]) * f,
      lon: from[1] + (to[1] - from[1]) * f,
      accuracy: 8,
      speed: 13,
    });
  }
  while (t < end) {
    fixes.push({ recordedAt: new Date(t).toISOString(), lat: to[0], lon: to[1], accuracy: 10, speed: 0 });
    t += iv;
  }
  return fixes;
}

describe('ingestion, trips and geofences', () => {
  it('ingests batches idempotently and filters invalid data', async () => {
    const u = await newUser(env, 'Ingest');
    const now = Date.now();
    const body = {
      deviceId: u.deviceId,
      locations: [
        { recordedAt: new Date(now - 2000).toISOString(), lat: 1, lon: 1, accuracy: 5 },
        { recordedAt: new Date(now + 3600_000).toISOString(), lat: 1, lon: 1 }, // future → rejected
      ],
    };
    const r1 = (await u.client.post('/api/locations', body)).json();
    expect(r1).toMatchObject({ accepted: 1, rejected: 1 });
    const r2 = (await u.client.post('/api/locations', body)).json();
    expect(r2).toMatchObject({ accepted: 0, duplicates: 1 });
    const bad = await u.client.post('/api/locations', { deviceId: u.deviceId, locations: [{ recordedAt: 'x', lat: 200, lon: 0 }] });
    expect(bad.statusCode).toBe(400);
  });

  it('accepts device tokens, OwnTracks and Overland payloads', async () => {
    const u = await newUser(env, 'Thirdparty');
    const created = (await u.client.post('/api/devices', { name: 'OwnTracks', kind: 'owntracks' })).json();
    const token = created.token as string;
    expect(token).toMatch(/^ndd_/);
    const tst = Math.floor(Date.now() / 1000) - 60;
    const basic = Buffer.from(`me:${token}`).toString('base64');
    const ot = await env.app.inject({
      method: 'POST',
      url: '/api/ingest/owntracks',
      headers: { authorization: `Basic ${basic}` },
      payload: { _type: 'location', lat: 44.6, lon: -63.6, tst, acc: 12, vel: 36, batt: 55, bs: 1 },
    });
    expect(ot.statusCode).toBe(200);
    const ov = await env.app.inject({
      method: 'POST',
      url: `/api/ingest/overland?token=${token}`,
      payload: {
        locations: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-63.61, 44.61] },
            properties: { timestamp: new Date().toISOString(), horizontal_accuracy: 6, speed: 4, battery_level: 0.5, battery_state: 'charging' },
          },
        ],
      },
    });
    expect(ov.json()).toEqual({ result: 'ok' });
    const rows = await env.sql<{ speed: number; battery: number; charging: boolean }[]>`
      SELECT speed, battery, charging FROM locations WHERE user_id = ${u.id} ORDER BY recorded_at`;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.speed).toBeCloseTo(10); // 36 km/h
    expect(rows[1]).toMatchObject({ battery: 50, charging: true });
    // Device tokens cannot read data.
    const read = await env.app.inject({ method: 'GET', url: '/api/live', headers: { authorization: `Bearer ${token}` } });
    expect(read.statusCode).toBe(401);
    // Revoked tokens stop working.
    await u.client.del(`/api/devices/${created.device.id}`);
    const after = await env.app.inject({
      method: 'POST',
      url: '/api/ingest/owntracks',
      headers: { authorization: `Basic ${basic}` },
      payload: { _type: 'location', lat: 44.6, lon: -63.6, tst: tst + 30 },
    });
    expect(after.statusCode).toBe(401);
  });

  it('detects trips and exposes them with routes, speeds and insights', async () => {
    const u = await newUser(env, 'Driver');
    const fixes = journey([44.6468, -63.5937], [44.7168, -63.6559], Date.now() - 1000); // ~9 km in 12 min
    await u.client.post('/api/locations', { deviceId: u.deviceId, locations: fixes });
    await processDeviceTrips(env.ctx, u.deviceId);
    const trips = (await u.client.get('/api/trips')).json();
    expect(trips).toHaveLength(1);
    const t = trips[0];
    expect(t.status).toBe('completed');
    expect(t.distanceM).toBeGreaterThan(3000);
    expect(t.maxSpeed).toBeCloseTo(13, 0);
    expect(t.mode).toBe('driving');
    const detail = (await u.client.get(`/api/trips/${t.id}`)).json();
    expect(detail.route.length).toBeGreaterThan(1);
    expect(detail.samples.length).toBeGreaterThan(10);
    const ins = (await u.client.get('/api/insights?period=week')).json();
    expect(ins.current.trips).toBe(1);
    expect(ins.buckets.length).toBe(7);
    const tz = encodeURIComponent('America/Halifax');
    const days = (await u.client.get(`/api/history/${u.id}/days?from=${new Date(Date.now() - 2 * 86_400_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}&tz=${tz}`)).json();
    expect(days.reduce((s: number, d: { trips: number }) => s + d.trips, 0)).toBe(1);
    const tl = (await u.client.get(`/api/history/${u.id}/timeline?from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`)).json();
    expect(tl.items.map((i: { type: string }) => i.type)).toEqual(['stay', 'trip', 'stay']);
  });

  it('decimates large history ranges', async () => {
    const u = await newUser(env, 'Decimate');
    const fixes = journey([44.6, -63.6], [44.62, -63.62], Date.now() - 1000);
    await u.client.post('/api/locations', { deviceId: u.deviceId, locations: fixes });
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const r = (await u.client.get(`/api/history/${u.id}/points?from=${from}&to=${to}&maxPoints=50`)).json();
    expect(r.total).toBe(fixes.length);
    expect(r.points.length).toBeLessThanOrEqual(51);
    expect(r.decimated).toBe(true);
    expect(r.distanceM).toBeGreaterThan(2000);
  });

  it('fires arrival and departure notifications with hysteresis and cooldown', async () => {
    const watcher = await newUser(env, 'Watcher');
    const kid = await newUser(env, 'Kid');
    const c = (await watcher.client.post('/api/circles', { name: 'Fam' })).json();
    const inv = (await watcher.client.post(`/api/circles/${c.id}/invitations`, {})).json();
    await kid.client.post(`/api/invitations/${inv.token}/accept`);
    // Pretend the kid joined an hour ago so the simulated fixes below are within the shared window.
    await env.sql`UPDATE circle_members SET sharing_since = now() - interval '1 hour' WHERE circle_id = ${c.id}`;
    const school = (await watcher.client.post('/api/places', { name: 'School', lat: 44.65, lon: -63.58, radiusM: 150, circleId: c.id })).json();
    const alerts = (await watcher.client.get(`/api/places/${school.id}/alerts`)).json();
    expect(alerts).toEqual([{ memberId: null, onArrive: true, onDepart: true }]);

    const t = Date.now() - 20 * 60_000;
    const at = (mins: number, lat: number) => ({ recordedAt: new Date(t + mins * 60_000).toISOString(), lat, lon: -63.58, accuracy: 10 });
    const send = (...f: unknown[]) => kid.client.post('/api/locations', { deviceId: kid.deviceId, locations: f });
    await send(at(0, 44.66)); // initial: outside, silent
    await send(at(1, 44.6505)); // inside → arrive
    await send(at(2, 44.6514)); // ~155 m: inside buffer → no event
    await send(at(10, 44.66)); // far → depart
    await send(at(10.5, 44.65)); // back within cooldown → arrive recorded, no notification

    const notes = (await watcher.client.get('/api/notifications')).json().items.filter((n: { type: string }) => ['arrival', 'departure'].includes(n.type));
    expect(notes.map((n: { type: string }) => n.type)).toEqual(['departure', 'arrival']);
    const events = (await watcher.client.get(`/api/place-events?placeId=${school.id}`)).json();
    expect(events.map((e: { kind: string }) => e.kind)).toEqual(['arrive', 'depart', 'arrive']);
    // The kid doesn't get notified about their own movements.
    const kidNotes = (await kid.client.get('/api/notifications')).json().items.filter((n: { type: string }) => n.type === 'arrival');
    expect(kidNotes).toHaveLength(0);
    // The live map shows the kid at School.
    const live = (await watcher.client.get(`/api/circles/${c.id}/live`)).json();
    expect(live.find((m: { id: string }) => m.id === kid.id).currentPlace.name).toBe('School');
  });

  it('applies retention and tells the user', async () => {
    const u = await newUser(env, 'Retain');
    await u.client.post('/api/locations', {
      deviceId: u.deviceId,
      locations: [
        { recordedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(), lat: 1, lon: 1 },
        { recordedAt: new Date(Date.now() - 1000).toISOString(), lat: 1, lon: 1 },
      ],
    });
    await u.client.patch('/api/me', { preferences: { retentionDays: 30 } });
    const preview = await runRetention(env.ctx, { dryRun: true });
    expect(preview.find((r) => r.userId === u.id)?.locations).toBe(1);
    await runRetention(env.ctx);
    const { n } = (await env.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM locations WHERE user_id = ${u.id}`)[0]!;
    expect(n).toBe(1);
    const notes = (await u.client.get('/api/notifications')).json().items;
    expect(notes[0].type).toBe('retention');
  });

  it('exports data in every format', async () => {
    const u = await newUser(env, 'Exporter');
    await u.client.post('/api/locations', { deviceId: u.deviceId, locations: [{ recordedAt: new Date(Date.now() - 1000).toISOString(), lat: 5, lon: 6 }] });
    const j = await u.client.get('/api/me/export?format=json');
    expect(JSON.parse(j.body).locations).toHaveLength(1);
    expect((await u.client.get('/api/me/export?format=gpx')).body).toContain('<trkpt lat="5" lon="6">');
    expect((await u.client.get('/api/me/export?format=csv')).body.split('\n')[1]).toContain(',5,6,');
    expect(JSON.parse((await u.client.get('/api/me/export?format=geojson')).body).features).toHaveLength(1);
  });
});
