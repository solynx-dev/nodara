import type { LocationFix, TrailPoint } from './types';

/**
 * Recent path of each person, fed by live updates. Phones upload in small
 * batches (every ~5 s in Precise mode, ~20 s in Battery saver), so on its own a
 * driving pin would jump from batch to batch. Keeping the actual points lets
 * the map replay the drive smoothly a few seconds behind real time.
 */
export interface PathPoint {
  t: number; // fix time, ms
  lat: number;
  lon: number;
  speed: number | null; // m/s
  heading: number | null; // degrees
}

interface Track {
  points: PathPoint[];
  /** Newest fix time we have, and when (on this phone's clock) it arrived. */
  newest: number;
  arrived: number;
  /** Typical time between uploads, in fix time: how far behind playback runs. */
  interval: number;
}

const KEEP_MS = 3 * 60_000;
const tracks = new Map<string, Track>();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const fromTrail = (p: TrailPoint): PathPoint => ({ t: Date.parse(p.t), lat: p.lat, lon: p.lon, speed: p.speed, heading: p.heading });
export const fromFix = (l: LocationFix): PathPoint => ({ t: Date.parse(l.recordedAt), lat: l.lat, lon: l.lon, speed: l.speed, heading: l.heading });

export function addLivePoints(userId: string, pts: PathPoint[]) {
  const fresh = pts.filter((p) => Number.isFinite(p.t));
  if (!fresh.length) return;
  const tr = tracks.get(userId) ?? { points: [], newest: 0, arrived: 0, interval: 5_000 };
  const byTime = new Map(tr.points.map((p) => [p.t, p]));
  for (const p of fresh) byTime.set(p.t, p);
  const sorted = [...byTime.values()].sort((a, b) => a.t - b.t);
  const newest = sorted[sorted.length - 1]!.t;
  if (newest > tr.newest) {
    const gap = tr.newest ? newest - tr.newest : fresh.length > 1 ? newest - fresh[0]!.t : 5_000;
    tr.interval = tr.newest ? clamp(0.6 * tr.interval + 0.4 * gap, 1_500, 30_000) : clamp(gap, 1_500, 30_000);
    tr.newest = newest;
    tr.arrived = Date.now();
  }
  tr.points = sorted.filter((p) => newest - p.t <= KEEP_MS);
  tracks.set(userId, tr);
}

export const getTrack = (userId: string) => tracks.get(userId);

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function bearing(a: PathPoint, b: PathPoint) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Move `meters` from a point along a heading (fine over a few hundred metres). */
function project(lat: number, lon: number, headingDeg: number, meters: number) {
  const h = rad(headingDeg);
  const dLat = (meters * Math.cos(h)) / R;
  const dLon = (meters * Math.sin(h)) / (R * Math.cos(rad(lat)));
  return { lat: lat + (dLat * 180) / Math.PI, lon: lon + (dLon * 180) / Math.PI };
}

export interface Shown {
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
}

/** How far ahead of the newest point we'll predict along the last speed and heading. */
const PREDICT_MS = 8_000;
/** Extra speed allowed when drifting back onto the real path after a prediction (m/s). */
const CATCH_UP_MPS = 15;
/** Never trail the newest point by more than this, even when uploads are further apart. */
const MAX_LAG_MS = 3_000;

/** Position along the path at a given fix time, predicting a few seconds past the newest point. */
export function positionAt(points: PathPoint[], t: number, maxAheadMs = PREDICT_MS): Shown | null {
  if (!points.length) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (t <= first.t) return { lat: first.lat, lon: first.lon, speed: first.speed, heading: first.heading };
  if (t >= last.t) {
    const prev = points[points.length - 2];
    const heading = last.heading ?? (prev ? bearing(prev, last) : null);
    const ahead = Math.min(t - last.t, maxAheadMs, PREDICT_MS) / 1000;
    if (heading != null && (last.speed ?? 0) >= 2 && ahead > 0) {
      const p = project(last.lat, last.lon, heading, (last.speed ?? 0) * ahead);
      return { ...p, speed: last.speed, heading };
    }
    return { lat: last.lat, lon: last.lon, speed: last.speed, heading };
  }
  let i = 0;
  while (i < points.length - 2 && points[i + 1]!.t <= t) i++;
  const a = points[i]!;
  const b = points[i + 1]!;
  const f = (t - a.t) / Math.max(1, b.t - a.t);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    speed: a.speed != null && b.speed != null ? a.speed + (b.speed - a.speed) * f : (b.speed ?? a.speed),
    heading: bearing(a, b),
  };
}

/**
 * Where the playback should be now, in fix time: behind the newest point by
 * the upload interval but at most 3 s, advancing in real time since it
 * arrived. After replaying the real path it predicts along the last speed and
 * heading until the next upload, so the pin stays close to live.
 */
export function playbackTarget(tr: { newest: number; arrived: number; interval: number }, now = Date.now()) {
  return tr.newest + (now - tr.arrived) - Math.min(tr.interval, MAX_LAG_MS) - 300;
}

export interface Playback {
  t: number; // fix time being shown
  at: number; // when it was shown
  lat: number;
  lon: number;
}

/**
 * One animation frame for one person. Time only moves forward (it slows down
 * rather than reversing when an upload arrives early). When the real path turns
 * out different from the prediction (a turn, a stop), the pin drifts onto it at
 * no more than 15 m/s faster than the car, so corrections glide, never lurch.
 */
export function advance(prev: Playback | undefined, tr: Track, now: number): { pb: Playback; shown: Shown } | null {
  const target = playbackTarget(tr, now);
  let t = target;
  if (prev) {
    const dt = Math.max(0, now - prev.at);
    const err = target - (prev.t + dt);
    t = Math.abs(err) > 15_000 ? target : Math.max(prev.t, prev.t + dt + err * Math.min(1, dt / 2000));
  }
  // Predict no further than the next upload is due.
  const p = positionAt(tr.points, t, tr.interval + 1_000);
  if (!p) return null;
  let { lat, lon } = p;
  if (prev) {
    const dt = Math.max(0, now - prev.at) / 1000;
    const dist = Math.hypot(lat - prev.lat, (lon - prev.lon) * Math.cos(rad(lat))) * 111_195;
    const allowed = ((p.speed ?? 0) + CATCH_UP_MPS) * dt;
    if (dist > allowed && dist < 2_000) {
      const f = allowed / dist;
      lat = prev.lat + (lat - prev.lat) * f;
      lon = prev.lon + (lon - prev.lon) * f;
    }
  }
  return { pb: { t, at: now, lat, lon }, shown: { ...p, lat, lon } };
}
