import { describe, expect, it } from 'vitest';
import { DEFAULT_TRIP_CONFIG, segmentTrips, type TPoint } from '../src/services/trip-detect.js';
import { computeSpeed, smoothedMax } from '../src/services/speed.js';
import { evaluateFence } from '../src/services/geofence-eval.js';

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
let nextId = 1;

/** Generate a track: stationary jitter, then linear movement, then stationary. */
function track(opts: {
  start: [number, number];
  end: [number, number];
  restBeforeMin: number;
  driveMin: number;
  restAfterMin: number;
  intervalSec?: number;
  jitterM?: number;
  t0?: number;
}): TPoint[] {
  const iv = (opts.intervalSec ?? 15) * 1000;
  const jitterDeg = (opts.jitterM ?? 10) / 111_000;
  const pts: TPoint[] = [];
  let t = opts.t0 ?? T0;
  const rand = mulberry(42);
  const jitter = () => (rand() - 0.5) * 2 * jitterDeg;
  const push = (lat: number, lon: number, speed: number) =>
    pts.push({ id: nextId++, t, lat: lat + jitter(), lon: lon + jitter(), accuracy: 12, speed });
  for (let i = 0; i < (opts.restBeforeMin * 60_000) / iv; i++, t += iv) push(...opts.start, 0);
  const n = (opts.driveMin * 60_000) / iv;
  for (let i = 0; i <= n; i++, t += iv) {
    const f = i / n;
    push(opts.start[0] + (opts.end[0] - opts.start[0]) * f, opts.start[1] + (opts.end[1] - opts.start[1]) * f, 14);
  }
  for (let i = 0; i < (opts.restAfterMin * 60_000) / iv; i++, t += iv) push(...opts.end, 0);
  return pts;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOME: [number, number] = [43.6532, -79.3832];
const WORK: [number, number] = [43.7001, -79.4163]; // ~5.9 km away

describe('segmentTrips', () => {
  it('detects a single trip between two stationary periods', () => {
    const pts = track({ start: HOME, end: WORK, restBeforeMin: 20, driveMin: 12, restAfterMin: 20 });
    const last = pts[pts.length - 1]!;
    const r = segmentTrips(pts, undefined, last.t + 1000);
    expect(r.completed).toHaveLength(1);
    expect(r.open).toBeNull();
    const trip = r.completed[0]!;
    expect(trip.distanceM).toBeGreaterThan(5500);
    expect(trip.distanceM).toBeLessThan(7000);
    expect(trip.durationSec).toBeGreaterThan(11 * 60);
    expect(trip.durationSec).toBeLessThan(15 * 60);
    expect(trip.maxSpeed).toBeCloseTo(14, 0);
    expect(r.state?.mode).toBe('stationary');
  });

  it('does not create trips from stationary GPS jitter', () => {
    const pts = track({ start: HOME, end: HOME, restBeforeMin: 120, driveMin: 0, restAfterMin: 0, jitterM: 60 });
    const r = segmentTrips(pts, undefined, pts[pts.length - 1]!.t);
    expect(r.completed).toHaveLength(0);
    expect(r.open).toBeNull();
  });

  it('reports an in-progress trip while still moving', () => {
    const pts = track({ start: HOME, end: WORK, restBeforeMin: 10, driveMin: 12, restAfterMin: 0 });
    const r = segmentTrips(pts, undefined, pts[pts.length - 1]!.t + 5000);
    expect(r.completed).toHaveLength(0);
    expect(r.open).not.toBeNull();
    expect(r.state?.mode).toBe('moving');
  });

  it('produces the same result incrementally as in one batch', () => {
    const a = track({ start: HOME, end: WORK, restBeforeMin: 10, driveMin: 12, restAfterMin: 15 });
    const b = track({
      start: WORK,
      end: HOME,
      restBeforeMin: 0,
      driveMin: 15,
      restAfterMin: 15,
      t0: a[a.length - 1]!.t + 15_000,
    });
    const all = [...a, ...b];
    const end = all[all.length - 1]!.t + 1000;
    const batch = segmentTrips(all, undefined, end);

    // Feed points in chunks, carrying state like the DB processor does.
    let state = null as ReturnType<typeof segmentTrips>['state'];
    const trips = [];
    let i = 0;
    while (i < all.length) {
      const chunkEnd = Math.min(all.length, i + 37);
      const from = state ? all.findIndex((p) => p.t > state!.last.t) : 0;
      const chunk = all.slice(from, chunkEnd);
      const r = segmentTrips(chunk, undefined, all[chunkEnd - 1]!.t, state);
      trips.push(...r.completed);
      state = r.state;
      i = chunkEnd;
    }
    expect(batch.completed).toHaveLength(2);
    expect(trips).toHaveLength(2);
    expect(trips[0]!.startedAt).toBe(batch.completed[0]!.startedAt);
    expect(trips[1]!.endedAt).toBe(batch.completed[1]!.endedAt);
  });

  it('records short pauses as stops instead of splitting the trip', () => {
    const iv = 15_000;
    const leg1 = track({ start: HOME, end: [43.67, -79.4], restBeforeMin: 10, driveMin: 6, restAfterMin: 3 });
    const leg2 = track({
      start: [43.67, -79.4],
      end: WORK,
      restBeforeMin: 0,
      driveMin: 6,
      restAfterMin: 12,
      t0: leg1[leg1.length - 1]!.t + iv,
    });
    const all = [...leg1, ...leg2];
    const r = segmentTrips(all, undefined, all[all.length - 1]!.t);
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0]!.stops.length).toBe(1);
  });

  it('ends a trip at a long data gap', () => {
    const pts = track({ start: HOME, end: WORK, restBeforeMin: 5, driveMin: 10, restAfterMin: 0 });
    const r = segmentTrips(pts, undefined, pts[pts.length - 1]!.t + 60 * 60_000);
    expect(r.completed).toHaveLength(1);
    expect(r.open).toBeNull();
  });
});

/** Build a track from legs: drive or walk to a point, or stay put, every `iv` seconds. */
function legs(start: [number, number], steps: ({ to: [number, number]; min: number; speed: number } | { stayMin: number })[], iv = 5, t0 = T0): TPoint[] {
  const pts: TPoint[] = [];
  let t = t0;
  let at = start;
  for (const s of steps) {
    if ('stayMin' in s) {
      for (let i = 0; i < (s.stayMin * 60) / iv; i++, t += iv * 1000) pts.push({ id: nextId++, t, lat: at[0], lon: at[1], accuracy: 8, speed: 0 });
      continue;
    }
    const n = Math.round((s.min * 60) / iv);
    for (let i = 1; i <= n; i++, t += iv * 1000) {
      const f = i / n;
      pts.push({ id: nextId++, t, lat: at[0] + (s.to[0] - at[0]) * f, lon: at[1] + (s.to[1] - at[1]) * f, accuracy: 8, speed: s.speed });
    }
    at = s.to;
  }
  return pts;
}
const MID: [number, number] = [43.675, -79.4]; // ~3 km from HOME
const NEAR_MID: [number, number] = [43.6772, -79.4]; // ~250 m north of MID (a walk)

describe('stops during a drive', () => {
  it('keeps a red light, and a short stop where you stay with the car, in the same drive', () => {
    const pts = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 1 }, { to: WORK, min: 4, speed: 13 }, { stayMin: 12 }]);
    const r = segmentTrips(pts, undefined, pts[pts.length - 1]!.t);
    expect(r.completed).toHaveLength(1);

    const longer = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 7 }, { to: WORK, min: 4, speed: 13 }, { stayMin: 12 }]);
    const r2 = segmentTrips(longer, undefined, longer[longer.length - 1]!.t);
    expect(r2.completed).toHaveLength(1);
    expect(r2.completed[0]!.stops).toHaveLength(1);
    expect(r2.completed[0]!.stops[0]!.durationSec).toBeGreaterThanOrEqual(6 * 60);
  });

  it('ends the drive after a long stop, or a shorter one at a saved place', () => {
    const parked = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 12 }, { to: WORK, min: 4, speed: 13 }, { stayMin: 12 }]);
    expect(segmentTrips(parked, undefined, parked[parked.length - 1]!.t).completed).toHaveLength(2);

    const atPlace = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 6 }, { to: WORK, min: 4, speed: 13 }, { stayMin: 12 }]);
    const cfg = { ...DEFAULT_TRIP_CONFIG, places: [{ lat: MID[0], lon: MID[1], radiusM: 100 }] };
    expect(segmentTrips(atPlace, cfg, atPlace[atPlace.length - 1]!.t).completed).toHaveLength(2);
  });

  it('ends the drive where you parked when you get out and walk', () => {
    const pts = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 2 }, { to: NEAR_MID, min: 3, speed: 1.4 }, { stayMin: 15 }]);
    const r = segmentTrips(pts, undefined, pts[pts.length - 1]!.t);
    const drive = r.completed[0]!;
    // The drive ends at the parking spot, not after the walk.
    expect(Math.abs(drive.points[drive.points.length - 1]!.lat - MID[0])).toBeLessThan(0.0005);
    expect(r.completed.every((t) => t === drive || (t.maxSpeed ?? 0) < 3)).toBe(true);
  });

  it('reports when an open drive came to a stop', () => {
    const moving = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }]);
    const r = segmentTrips(moving, undefined, moving[moving.length - 1]!.t);
    expect(r.open?.stoppedSince).toBeNull();

    const stopped = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 1 }]);
    const r2 = segmentTrips(stopped, undefined, stopped[stopped.length - 1]!.t);
    expect(r2.open).not.toBeNull();
    const firstStill = stopped.find((p) => p.speed === 0 && p.t > stopped[0]!.t + 6 * 60_000)!;
    expect(r2.open!.stoppedSince).toBe(firstStill.t);
  });

  it('closes a drive when the phone goes quiet after parking', () => {
    const pts = legs(HOME, [{ stayMin: 6 }, { to: MID, min: 4, speed: 13 }, { stayMin: 0.5 }]);
    const last = pts[pts.length - 1]!.t;
    expect(segmentTrips(pts, undefined, last + 3 * 60_000).open).not.toBeNull();
    const r = segmentTrips(pts, undefined, last + 11 * 60_000);
    expect(r.open).toBeNull();
    expect(r.completed).toHaveLength(1);
  });
});

describe('GPS jumps while staying put', () => {
  it("doesn't turn a night of jumpy indoor fixes into a trip glued to the morning drive", () => {
    const rand = mulberry(7);
    const night: TPoint[] = [];
    const evening = T0 - 10 * 3600_000; // 10 PM
    // Indoor Wi-Fi positions every ~6 minutes, hopping up to ~260 m around home, no GPS speed.
    for (let t = evening; t < T0; t += 6 * 60_000) {
      const r = 260 * Math.sqrt(rand());
      const a = rand() * 2 * Math.PI;
      night.push({ id: nextId++, t, lat: HOME[0] + (r * Math.cos(a)) / 111_000, lon: HOME[1] + (r * Math.sin(a)) / 80_000, accuracy: 40 + rand() * 50, speed: null });
    }
    const drive = legs(HOME, [{ stayMin: 3 }, { to: WORK, min: 9, speed: 11 }, { stayMin: 15 }], 5, T0);
    const all = [...night, ...drive];
    const r = segmentTrips(all, undefined, all[all.length - 1]!.t);
    expect(r.completed).toHaveLength(1);
    const trip = r.completed[0]!;
    expect(trip.startedAt).toBeGreaterThanOrEqual(T0);
    expect(trip.durationSec).toBeLessThan(15 * 60);
    expect(trip.movingSec).toBeLessThan(11 * 60);
  });

  it('ends a trip that turns into wandering around one spot, even with jumpy fixes', () => {
    const rand = mulberry(3);
    const pts = legs(HOME, [{ stayMin: 3 }, { to: MID, min: 4, speed: 13 }], 5, T0);
    let t = pts[pts.length - 1]!.t;
    // Then 40 minutes of fixes hopping 125–200 m around MID (just outside the stop radius).
    for (let i = 0; i < 80; i++) {
      t += 30_000;
      const r = 125 + 75 * rand();
      const a = rand() * 2 * Math.PI;
      pts.push({ id: nextId++, t, lat: MID[0] + (r * Math.cos(a)) / 111_000, lon: MID[1] + (r * Math.sin(a)) / 80_000, accuracy: 20, speed: 0.3 });
    }
    const r = segmentTrips(pts, undefined, t);
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0]!.durationSec).toBeLessThan(10 * 60);
    expect(r.open).toBeNull();
  });
});

describe('computeSpeed', () => {
  const base = { t: T0, lat: HOME[0], lon: HOME[1], accuracy: 10, speed: null };
  it('prefers GNSS-reported speed', () => {
    expect(computeSpeed(null, { ...base, speed: 12.3 })).toEqual({ speed: 12.3, source: 'gps' });
  });
  it('clamps stationary jitter to zero', () => {
    expect(computeSpeed(null, { ...base, speed: 0.3 }).speed).toBe(0);
    const moved = { ...base, t: T0 + 10_000, lat: HOME[0] + 0.0001 }; // ~11 m, inside noise
    expect(computeSpeed(base, moved)).toEqual({ speed: 0, source: 'derived' });
  });
  it('rejects implausible spikes', () => {
    const jump = { ...base, t: T0 + 1000, lat: HOME[0] + 0.01 }; // 1.1 km in 1 s
    expect(computeSpeed(base, jump).speed).toBeNull();
    expect(computeSpeed(null, { ...base, speed: 200 }).speed).toBeNull();
  });
  it('ignores inaccurate fixes', () => {
    expect(computeSpeed(null, { ...base, accuracy: 500, speed: 10 }).source).toBe('none');
  });
  it('smoothedMax ignores a single spike', () => {
    expect(smoothedMax([10, 11, 60, 12, 11])).toBe(12);
  });
});

describe('evaluateFence', () => {
  it('initialises silently', () => {
    expect(evaluateFence(null, 10, 100, 10)).toEqual({ inside: true, event: null });
  });
  it('emits arrive and depart with hysteresis', () => {
    expect(evaluateFence(false, 80, 100, 10)).toEqual({ inside: true, event: 'arrive' });
    expect(evaluateFence(true, 110, 100, 10)).toEqual({ inside: true, event: null });
    expect(evaluateFence(true, 140, 100, 10)).toEqual({ inside: false, event: 'depart' });
  });
  it('ignores very inaccurate fixes', () => {
    expect(evaluateFence(true, 2000, 100, 1500)).toEqual({ inside: true, event: null });
  });
});
