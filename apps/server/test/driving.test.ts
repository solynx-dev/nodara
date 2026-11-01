import { describe, expect, it } from 'vitest';
import { detectDriving, type DrivingFix } from '../src/services/driving.js';
import { newUser, useTestEnv } from './helpers.js';

const env = useTestEnv();
const T0 = Date.now() - 30 * 60_000;
const fix = (sec: number, speed: number | null, extra: Partial<DrivingFix> = {}): DrivingFix => ({
  t: T0 + sec * 1000,
  lat: 45 + sec * 0.0002,
  lon: -64,
  speed,
  source: 'gps',
  accuracy: 8,
  shared: true,
  ...extra,
});

describe('driving event detection (pure)', () => {
  const LIMIT = 130 / 3.6;

  it('flags speeding fixes at or above the limit, ignoring imprecise ones', () => {
    const r = detectDriving(null, [fix(0, 30), fix(1, 37), fix(2, 38, { accuracy: 80 }), fix(3, 36.2)], LIMIT);
    expect(r.speeding.map((f) => f.speed)).toEqual([37, 36.2]);
  });

  it('finds hard braking and rapid acceleration from GPS speed changes', () => {
    const r = detectDriving(null, [fix(0, 25), fix(1, 20), fix(2, 19), fix(10, 2), fix(11.5, 8)], LIMIT);
    expect(r.harsh.map((h) => h.kind)).toEqual(['hard_brake', 'rapid_accel']);
    expect(r.harsh[0]!.accel).toBeCloseTo(-5);
    expect(r.harsh[0]!.speed).toBe(25);
  });

  it('ignores slow manoeuvres, long gaps and derived speeds', () => {
    const slow = detectDriving(null, [fix(0, 5), fix(1, 0)], LIMIT); // parking
    const gap = detectDriving(null, [fix(0, 25), fix(8, 0)], LIMIT); // 8 s apart: unknowable
    const derived = detectDriving(null, [fix(0, 25, { source: 'derived' }), fix(1, 18, { source: 'derived' })], LIMIT);
    expect([slow.harsh, gap.harsh, derived.harsh]).toEqual([[], [], []]);
  });

  it('counts one event per manoeuvre', () => {
    const r = detectDriving(null, [fix(0, 30), fix(1, 25), fix(2, 19), fix(3, 13)], LIMIT);
    expect(r.harsh).toHaveLength(1);
    expect(r.harsh[0]!.accel).toBeCloseTo(-6);
  });
});

describe('driving reports', () => {
  it('records events from uploads and reports them weekly, respecting circle privacy', async () => {
    const driver = await newUser(env, 'Driver');
    const watcher = await newUser(env, 'Watcher');
    const circle = (await driver.client.post('/api/circles', { name: 'Car' })).json();
    const inv = (await driver.client.post(`/api/circles/${circle.id}/invitations`, { maxUses: 1 })).json();
    await watcher.client.post(`/api/invitations/${inv.token}/accept`);

    // A minute ago: cruising, a burst over 130 km/h, a hard stop, then a quick getaway.
    const base = Date.now() - 60_000;
    const at = (sec: number, speed: number) => ({ recordedAt: new Date(base + sec * 1000).toISOString(), lat: 45 + sec * 0.0003, lon: -64, accuracy: 8, speed });
    const r = await driver.client.post('/api/locations', {
      deviceId: driver.deviceId,
      locations: [at(0, 33), at(1, 35), at(2, 37), at(3, 38), at(4, 37.5), at(5, 36), at(6, 30), at(7, 29), at(20, 2), at(21.5, 8), at(22.5, 10)],
    });
    expect(r.json().accepted).toBe(11);

    // Phone unlocked while moving counts; one while parked doesn't.
    const phone = await driver.client.post('/api/driving/phone-use', { deviceId: driver.deviceId, times: [new Date(base + 2000).toISOString(), Date.now() - 3600_000] });
    expect(phone.json().recorded).toBe(1);

    const tz = 'UTC';
    const mine = (await driver.client.get(`/api/driving/report?tz=${tz}`)).json();
    const me = mine.people.find((p: { user: { id: string } }) => p.user.id === driver.id);
    expect(me.events).toEqual({ speeding: 1, phone_use: 1, rapid_accel: 1, hard_brake: 1 });
    expect(mine.totals.events.speeding).toBe(1);

    const events = (await watcher.client.get(`/api/driving/events?userId=${driver.id}&from=${new Date(base - 1000).toISOString()}&to=${new Date().toISOString()}`)).json();
    expect(events.map((e: { kind: string }) => e.kind).sort()).toEqual(['hard_brake', 'phone_use', 'rapid_accel', 'speeding']);
    const speeding = events.find((e: { kind: string }) => e.kind === 'speeding');
    expect(speeding.speed).toBeCloseTo(38);

    // Circle hides drives: the watcher sees a locked entry and no events.
    await driver.client.patch(`/api/circles/${circle.id}`, { settings: { tripsVisible: false } });
    const theirs = (await watcher.client.get(`/api/driving/report?circleId=${circle.id}`)).json();
    expect(theirs.people.find((p: { user: { id: string } }) => p.user.id === driver.id).hidden).toBe(true);
    expect((await watcher.client.get(`/api/driving/events?userId=${driver.id}&from=${new Date(base - 1000).toISOString()}&to=${new Date().toISOString()}`)).statusCode).toBe(404);
  });
});
