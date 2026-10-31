import { haversine, type SpeedSource } from '@nodara/shared';

export interface SpeedInput {
  t: number; // epoch ms
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null; // device-reported m/s
}

export interface SpeedResult {
  speed: number | null;
  source: SpeedSource;
}

/** Anything faster than this (≈ 324 km/h) is treated as a GPS glitch. */
export const MAX_PLAUSIBLE_SPEED = 90;
/** Device-reported speeds below this are stationary jitter. */
export const STATIONARY_SPEED = 0.5;
/** Fixes worse than this are not used for speed at all. */
export const MAX_SPEED_ACCURACY = 100;
const DEFAULT_ACCURACY = 25;
const MAX_DERIVE_GAP_S = 300;

/**
 * Determine the speed to store for a fix.
 *
 * Prefers the speed reported by the GNSS chip (Doppler-derived, very accurate)
 * when the fix is reasonably precise. Otherwise derives speed from the distance
 * to the previous fix, but only when that distance exceeds the combined
 * accuracy radii — otherwise the "movement" is indistinguishable from noise and
 * the speed is reported as 0.
 */
export function computeSpeed(prev: SpeedInput | null, cur: SpeedInput): SpeedResult {
  const acc = cur.accuracy ?? DEFAULT_ACCURACY;
  if (acc > MAX_SPEED_ACCURACY) return { speed: null, source: 'none' };

  if (cur.speed != null && Number.isFinite(cur.speed) && cur.speed >= 0 && acc <= 50) {
    if (cur.speed > MAX_PLAUSIBLE_SPEED) return { speed: null, source: 'none' };
    return { speed: cur.speed < STATIONARY_SPEED ? 0 : cur.speed, source: 'gps' };
  }

  if (!prev) return { speed: null, source: 'none' };
  const dt = (cur.t - prev.t) / 1000;
  if (dt <= 0 || dt > MAX_DERIVE_GAP_S) return { speed: null, source: 'none' };
  const prevAcc = prev.accuracy ?? DEFAULT_ACCURACY;
  if (prevAcc > MAX_SPEED_ACCURACY) return { speed: null, source: 'none' };

  const d = haversine(prev.lat, prev.lon, cur.lat, cur.lon);
  const noise = acc + prevAcc;
  if (d <= noise) return { speed: 0, source: 'derived' };
  const v = d / dt;
  if (v > MAX_PLAUSIBLE_SPEED) return { speed: null, source: 'none' };
  return { speed: v, source: 'derived' };
}

/**
 * Median-of-three smoothing used for "max speed" statistics so a single spike
 * cannot dominate a trip report.
 */
export function smoothedMax(speeds: (number | null)[]): number | null {
  const vals = speeds.filter((s): s is number => s != null);
  if (vals.length === 0) return null;
  if (vals.length < 3) return Math.min(...vals);
  let max = 0;
  for (let i = 1; i < vals.length - 1; i++) {
    const w = [vals[i - 1]!, vals[i]!, vals[i + 1]!].sort((a, b) => a - b);
    max = Math.max(max, w[1]!);
  }
  return max;
}
