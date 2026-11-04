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
  /** ... for this long at a saved place ends a trip. */
  endAfterSec: number;
  /**
   * Anywhere else, a stop has to last this long to end the trip. Shorter
   * stops where you stay with the car (a drive-thru, a gas station, waiting
   * to pick someone up) stay part of the same drive.
   */
  parkedEndSec: number;
  /** A trip that reaches this speed is a drive (m/s, ≈ 25 km/h). */
  vehicleSpeedMps: number;
  /**
   * After a stop of at least `stopMinSec` in a drive, moving on at walking
   * pace for this far means you got out and walked: the drive ends at the stop.
   */
  walkAwayM: number;
  /**
   * Hanging around inside this radius, never faster than walking, for
   * `parkedEndSec` also ends a trip, even when the fixes hop around (indoor
   * Wi-Fi positions can jump a couple of hundred metres).
   */
  wanderRadiusM: number;
  /** Saved places: stopping at one ends a trip after `endAfterSec`. */
  places?: { lat: number; lon: number; radiusM: number }[];
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
  parkedEndSec: 10 * 60,
  vehicleSpeedMps: 7,
  walkAwayM: 120,
  wanderRadiusM: 300,
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
  /** Open trips: since when they've been standing still (null while moving). */
  stoppedSince?: number | null;
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
  // Last fix within stopRadiusM of the anchor, and the in-between fixes since then.
  let lastStationary: TPoint | null = null;
  let drift: TPoint[] = [];
  /** Fixes in a row beyond the departure radius: one alone may be a GPS jump. */
  let beyond = 0;
  if (init) {
    anchor = init.anchor;
    lastStationary = init.last;
  }

  let trip: TPoint[] | null = null;
  let dwellIdx = 0; // index into trip of the current dwell anchor
  let tripAnchor: TPoint | null = null; // resting anchor the current trip departed from
  let vehicle = false; // the current trip has reached driving speed
  // A stop in a drive that the person may have walked away from: [dwell anchor, last fix of the stop].
  let walkCheck: { dwellIdx: number; lastIdx: number } | null = null;

  /** How far a fix may be off (capped: fixes worse than maxAccuracyM are already dropped). */
  const err = (p: TPoint) => Math.min(p.accuracy ?? 0, cfg.maxAccuracyM);
  const atPlace = (p: TPoint) => (cfg.places ?? []).some((pl) => haversine(pl.lat, pl.lon, p.lat, p.lon) <= pl.radiusM + 75);
  /** How long a stop here must last to end the trip. */
  const stopLimitSec = (p: TPoint) => (atPlace(p) ? cfg.endAfterSec : Math.max(cfg.endAfterSec, cfg.parkedEndSec));
  /** Recorded speed, or the speed from the previous fix when the device didn't report one. */
  const speedOf = (p: TPoint, prev: TPoint | undefined) => {
    if (p.speed != null) return p.speed;
    if (!prev) return 0;
    const dt = (p.t - prev.t) / 1000;
    return dt >= 3 ? haversine(prev.lat, prev.lon, p.lat, p.lon) / dt : 0;
  };

  const finish = (endIdx: number, settleAt?: TPoint) => {
    const t = trip!.slice(0, endIdx + 1);
    const built = buildTrip(t, cfg);
    if (built) completed.push(built);
    const end = t[t.length - 1]!;
    // Points after the end are the beginning of the next stationary period.
    const rest = trip!.slice(endIdx + 1);
    trip = null;
    vehicle = false;
    walkCheck = null;
    anchor = settleAt ?? end;
    lastStationary = end;
    drift = [];
    beyond = 0;
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
        drift = [];
        return;
      }
      trip.push(p);
      const speed = speedOf(p, prev);
      if (speed >= cfg.vehicleSpeedMps) vehicle = true;
      const dwell = trip[dwellIdx]!;
      // An imprecise fix only counts as leaving if it's clearly outside, error included.
      if (haversine(dwell.lat, dwell.lon, p.lat, p.lon) > cfg.stopRadiusM + err(p)) {
        // Leaving a stop. If a drive stopped for a while, watch whether they drive on or walk off.
        if (vehicle && dwellIdx < trip.length - 2 && (prev.t - dwell.t) / 1000 >= cfg.stopMinSec) {
          walkCheck = { dwellIdx, lastIdx: trip.length - 2 };
        }
        dwellIdx = trip.length - 1;
      } else if ((p.t - dwell.t) / 1000 >= stopLimitSec(dwell)) {
        finish(dwellIdx);
        return;
      }
      if (walkCheck) {
        if (speed >= 4) walkCheck = null; // driving again: it was just a stop
        else {
          const from = trip[walkCheck.lastIdx]!;
          if (haversine(from.lat, from.lon, p.lat, p.lon) >= cfg.walkAwayM) {
            finish(walkCheck.dwellIdx);
            return;
          }
        }
      }
      // Hanging around one area at walking pace or slower for a while: they've stopped,
      // even if jumpy fixes kept resetting the stop above.
      const windowStart = p.t - Math.max(cfg.endAfterSec, cfg.parkedEndSec) * 1000;
      if (trip[0]!.t <= windowStart) {
        let i = trip.length - 1;
        while (i > 0 && trip[i]!.t > windowStart) i--;
        const a = trip[i]!;
        const win = trip.slice(i);
        // Measured from the middle of where they've been, not from one jumpy fix.
        const lat = win.reduce((sum, q) => sum + q.lat, 0) / win.length;
        const lon = win.reduce((sum, q) => sum + q.lon, 0) / win.length;
        const still = win.every((q) => (q.speed ?? 0) < 2.5 && haversine(lat, lon, q.lat, q.lon) <= cfg.wanderRadiusM);
        if (still && i > 0) finish(i, { ...a, lat, lon });
      }
      return;
    }
    if (!anchor) {
      anchor = p;
      lastStationary = p;
      return;
    }
    const d = haversine(anchor.lat, anchor.lon, p.lat, p.lon);
    // Leaving needs to be real: clear of the radius even allowing for the fix's error,
    // and confirmed by a second fix (or a fix that's actually moving).
    const out = d - err(p) > cfg.departRadiusM;
    if (out) beyond++;
    if (out && (beyond >= 2 || (p.speed ?? 0) >= 2)) {
      // The trip starts at the last fix that was still at the resting place,
      // and includes the fixes that drifted away from it before the threshold.
      const start = lastStationary ?? anchor;
      tripAnchor = anchor;
      trip = [start, ...drift, p];
      drift = [];
      dwellIdx = trip.length - 1;
      vehicle = trip.some((q, i) => speedOf(q, trip![i - 1]) >= cfg.vehicleSpeedMps);
      walkCheck = null;
      beyond = 0;
    } else if (d <= cfg.stopRadiusM + err(p)) {
      lastStationary = p;
      drift = [];
      beyond = 0;
    } else {
      drift.push(p);
    }
  };

  for (const p of pts) step(p);

  // Close a trailing trip if the device has gone quiet.
  const pending = trip as TPoint[] | null;
  if (pending) {
    const last = pending[pending.length - 1]!;
    const dwell = pending[dwellIdx]!;
    if ((now - last.t) / 1000 > cfg.maxGapSec) finish(pending.length - 1);
    // A quiet phone has usually stopped (iOS sends nothing while still).
    else if ((now - dwell.t) / 1000 >= Math.max(stopLimitSec(dwell), cfg.endAfterSec * 2)) finish(dwellIdx);
  }

  const still = trip as TPoint[] | null;
  let open: DetectedTrip | null = null;
  let state: DetectorState | null = null;
  if (still) {
    open = buildTrip(still, cfg, true);
    if (open) open.stoppedSince = stoppedSince(still);
    state = { mode: 'moving', anchor: tripAnchor!, last: still[0]! };
  } else if (anchor && lastStationary) {
    state = { mode: 'stationary', anchor, last: lastStationary };
  }

  return { completed, open, state };
}

/** When the person came to a stop: the start of the run of still fixes at the end of the track. */
export function stoppedSince(points: TPoint[]): number | null {
  const last = points[points.length - 1];
  if (!last || (last.speed ?? 0) >= 1) return null;
  let since = last.t;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]!;
    if ((p.speed ?? 0) >= 1 || haversine(p.lat, p.lon, last.lat, last.lon) > 40) break;
    since = p.t;
  }
  return since;
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
    // Ignore hops smaller than the fixes' own error (indoor positions jump around).
    const real = d > ((a.accuracy ?? 0) + (b.accuracy ?? 0)) / 2;
    if (real || b.speed != null) distance += d;
    // Moving time: GPS speed when the phone reports it, else distance over time.
    const moving = b.speed != null ? b.speed >= 0.7 : real && dt > 0 && d / (dt / 1000) > 0.7;
    if (dt > 0 && moving) movingMs += dt;

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
