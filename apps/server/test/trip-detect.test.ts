import { describe, expect, it } from 'vitest';
import { segmentTrips, type TPoint } from '../src/services/trip-detect.js';
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
