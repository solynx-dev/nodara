import { haversine } from '@nodara/shared';
import { smoothedMax } from './speed.js';

/** A location fix as seen by the trip detector. */
export interface TPoint {
  id: number;
  t: number; // epoch ms
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
}

export interface TripConfig {
  /** Fixes less accurate than this are ignored for trip detection. */
  maxAccuracyM: number;
  /** Moving further than this from the resting point starts a trip. */
  departRadiusM: number;
  /** Staying within this radius ... */
  stopRadiusM: number;
  /** ... for this long ends a trip. */
  endAfterSec: number;
  /** Shorter pauses (≥ this) are recorded as stops within a trip. */
  stopMinSec: number;
  /** A data gap longer than this ends a trip at the last fix before the gap. */
  maxGapSec: number;
  /** Trips shorter than this distance or duration are discarded as noise. */
  minDistanceM: number;
  minDurationSec: number;
}

export const DEFAULT_TRIP_CONFIG: TripConfig = {
  maxAccuracyM: 100,
  departRadiusM: 200,
  stopRadiusM: 100,
  endAfterSec: 5 * 60,
  stopMinSec: 90,
  maxGapSec: 20 * 60,
  minDistanceM: 400,
  minDurationSec: 120,
};

export interface TripStop {
  lat: number;
  lon: number;
  arrivedAt: string;
  departedAt: string;
  durationSec: number;
}

export interface DetectedTrip {
  points: TPoint[];
  startedAt: number;
  endedAt: number;
  durationSec: number;
  movingSec: number;
  distanceM: number;
  maxSpeed: number | null;
  avgMovingSpeed: number | null;
  avgSpeed: number | null;
  stops: TripStop[];
  lowConfidence: boolean;
}

/**
 * State carried between incremental runs. In both modes the next run resumes
 * with fixes strictly after `last.t`: while stationary, `last` is the latest
 * resting fix; while moving, it is the fix the open trip started from (so the
 * open trip is re-segmented from its start each run).
 */
export interface DetectorState {
  mode: 'stationary' | 'moving';
  anchor: TPoint;
  last: TPoint;
}

export interface SegmentResult {
  completed: DetectedTrip[];
  open: DetectedTrip | null;
  state: DetectorState | null;
}

/**
 * Segment a time-ordered series of fixes into trips.
 *
 * The detector is a two-state machine:
 *  - stationary: we remember an *anchor* (where the person settled). Leaving
 *    `departRadiusM` around it starts a trip at the last stationary fix.
 *  - moving: we track a *dwell anchor*. Remaining within `stopRadiusM` of it
 *    for `endAfterSec` ends the trip at the dwell anchor; shorter dwells are
 *    stops. A long data gap also ends the trip.
 *
 * Candidate trips that are too short (distance or time) are discarded so GPS
 * drift does not produce hundreds of micro-trips.
 */
export function segmentTrips(
  input: TPoint[],
  cfg: TripConfig = DEFAULT_TRIP_CONFIG,
  now: number = Date.now(),
  init: DetectorState | null = null,
): SegmentResult {
  const pts = input.filter((p) => p.accuracy == null || p.accuracy <= cfg.maxAccuracyM);
  const completed: DetectedTrip[] = [];

  let anchor: TPoint | null = null;
  let lastStationary: TPoint | null = null;
  if (init) {
    anchor = init.anchor;
    lastStationary = init.last;
  }

  let trip: TPoint[] | null = null;
  let dwellIdx = 0; // index into trip of the current dwell anchor
  let tripAnchor: TPoint | null = null; // resting anchor the current trip departed from

  const finish = (endIdx: number) => {
    const t = trip!.slice(0, endIdx + 1);
    const built = buildTrip(t, cfg);
    if (built) completed.push(built);
    const end = t[t.length - 1]!;
    // Points after the end are the beginning of the next stationary period.
    const rest = trip!.slice(endIdx + 1);
    trip = null;
    anchor = end;
    lastStationary = end;
    for (const p of rest) step(p);
  };

  const step = (p: TPoint) => {
    if (trip) {
      const prev = trip[trip.length - 1]!;
      if ((p.t - prev.t) / 1000 > cfg.maxGapSec) {
        finish(trip.length - 1);
        // After a gap, start fresh from this point.
        anchor = p;
        lastStationary = p;
        return;
      }
      trip.push(p);
      const dwell = trip[dwellIdx]!;
      if (haversine(dwell.lat, dwell.lon, p.lat, p.lon) > cfg.stopRadiusM) {
        dwellIdx = trip.length - 1;
      } else if ((p.t - dwell.t) / 1000 >= cfg.endAfterSec) {
        finish(dwellIdx);
      }
      return;
    }
    if (!anchor) {
      anchor = p;
      lastStationary = p;
      return;
    }
    const d = haversine(anchor.lat, anchor.lon, p.lat, p.lon);
    if (d > cfg.departRadiusM) {
      const start = lastStationary ?? anchor;
      tripAnchor = anchor;
      trip = [start, p];
      dwellIdx = 1;
    } else {
      lastStationary = p;
    }
  };

  for (const p of pts) step(p);

  // Close a trailing trip if the device has gone quiet.
  const pending = trip as TPoint[] | null;
  if (pending) {
    const last = pending[pending.length - 1]!;
    const dwell = pending[dwellIdx]!;
    if ((now - last.t) / 1000 > cfg.maxGapSec) finish(pending.length - 1);
    else if ((now - dwell.t) / 1000 >= cfg.endAfterSec * 2) finish(dwellIdx);
  }

  const still = trip as TPoint[] | null;
  let open: DetectedTrip | null = null;
  let state: DetectorState | null = null;
  if (still) {
    open = buildTrip(still, cfg, true);
    state = { mode: 'moving', anchor: tripAnchor!, last: still[0]! };
  } else if (anchor && lastStationary) {
    state = { mode: 'stationary', anchor, last: lastStationary };
  }

  return { completed, open, state };
}

function buildTrip(points: TPoint[], cfg: TripConfig, allowShort = false): DetectedTrip | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let distance = 0;
  let movingMs = 0;
  const stops: TripStop[] = [];
  let dwellStart = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    const dt = b.t - a.t;
    distance += d;
    if (dt > 0 && d / (dt / 1000) > 0.7) movingMs += dt;

    // Stop detection inside the trip.
    const anchor = points[dwellStart]!;
    if (haversine(anchor.lat, anchor.lon, b.lat, b.lon) > cfg.stopRadiusM) {
      const prev = points[i - 1]!;
      const dur = (prev.t - anchor.t) / 1000;
      if (dur >= cfg.stopMinSec && dwellStart > 0) {
        stops.push({
          lat: anchor.lat,
          lon: anchor.lon,
          arrivedAt: new Date(anchor.t).toISOString(),
          departedAt: new Date(prev.t).toISOString(),
          durationSec: Math.round(dur),
        });
      }
      dwellStart = i;
    }
  }

  const durationSec = (last.t - first.t) / 1000;
  if (!allowShort && (distance < cfg.minDistanceM || durationSec < cfg.minDurationSec)) return null;
  // A "trip" that ends where it started with tiny net displacement and almost no
  // moving time is drift, not travel.
  if (!allowShort && movingMs / 1000 < 30) return null;

  const accs = points.map((p) => p.accuracy).filter((a): a is number => a != null).sort((a, b) => a - b);
  const medianAcc = accs.length ? accs[Math.floor(accs.length / 2)]! : null;
  const avgInterval = durationSec / Math.max(1, points.length - 1);
  const movingSec = movingMs / 1000;

  // Prefer recorded speeds; fall back to segment speeds for max speed.
  const recorded = points.map((p) => p.speed);
  const hasRecorded = recorded.some((s) => s != null);
  const segSpeeds: (number | null)[] = hasRecorded
    ? recorded
    : points.slice(1).map((b, i) => {
        const a = points[i]!;
        const dt = (b.t - a.t) / 1000;
        return dt > 0 ? haversine(a.lat, a.lon, b.lat, b.lon) / dt : null;
      });

  return {
    points,
    startedAt: first.t,
    endedAt: last.t,
    durationSec: Math.round(durationSec),
    movingSec: Math.round(movingSec),
    distanceM: distance,
    maxSpeed: smoothedMax(segSpeeds),
    avgMovingSpeed: movingSec > 0 ? distance / movingSec : null,
    avgSpeed: durationSec > 0 ? distance / durationSec : null,
    stops,
    lowConfidence: (medianAcc != null && medianAcc > 50) || avgInterval > 120 || !hasRecorded,
  };
}
