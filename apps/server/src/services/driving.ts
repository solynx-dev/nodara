import type { SpeedSource } from '@nodara/shared';
import type { Ctx } from '../context.js';

/**
 * Driving events, estimated from what a phone can honestly measure:
 *
 * - speeding: GPS speed at or above a fixed limit (default 130 km/h) for at
 *   least two fixes. Nodara has no speed-limit data, so this means "very fast",
 *   not "over the posted limit".
 * - hard braking / rapid acceleration: the GPS (Doppler) speed changing by
 *   ≥ 3.5 m/s² between two precise fixes taken 1–5 s apart.
 * - phone use: the phone was unlocked (or Nodara opened) while moving faster
 *   than 16 km/h. Passengers count too; the app says so.
 */
export type DrivingKind = 'speeding' | 'hard_brake' | 'rapid_accel' | 'phone_use';
export const DRIVING_KINDS: DrivingKind[] = ['speeding', 'phone_use', 'rapid_accel', 'hard_brake'];

export const HARSH_MPS2 = 3.5;
const HARSH_MIN_SPEED = 6; // m/s ≈ 22 km/h
const HARSH_MAX_ACCURACY = 30;
const HARSH_MIN_DT = 0.8;
const HARSH_MAX_DT = 5;
const HARSH_DEDUPE_MS = 20_000;
const SPEEDING_MAX_ACCURACY = 50;
const SPEEDING_GAP_MS = 60_000;
export const PHONE_USE_MIN_SPEED = 4.5; // m/s ≈ 16 km/h
const PHONE_USE_WINDOW_MS = 45_000;
const PHONE_USE_DEDUPE_MS = 2 * 60_000;

export interface DrivingFix {
  t: number;
  lat: number;
  lon: number;
  speed: number | null;
  source: SpeedSource;
  accuracy: number | null;
  shared: boolean;
}

export interface HarshEvent {
  kind: 'hard_brake' | 'rapid_accel';
  at: DrivingFix;
  accel: number;
  speed: number;
}

/** Pure detection over ordered fixes from one device. `prev` is the fix before the batch, if any. */
export function detectDriving(prev: DrivingFix | null, fixes: DrivingFix[], speedingMps: number) {
  const speeding = fixes.filter((f) => f.speed != null && f.speed >= speedingMps && (f.accuracy ?? 0) <= SPEEDING_MAX_ACCURACY);
  const harsh: HarshEvent[] = [];
  let last = prev;
  for (const cur of fixes) {
    const usable = (f: DrivingFix | null): f is DrivingFix => !!f && f.source === 'gps' && f.speed != null && f.accuracy != null && f.accuracy <= HARSH_MAX_ACCURACY;
    if (usable(last) && usable(cur)) {
      const dt = (cur.t - last.t) / 1000;
      if (dt >= HARSH_MIN_DT && dt <= HARSH_MAX_DT) {
        const accel = (cur.speed! - last.speed!) / dt;
        if (accel <= -HARSH_MPS2 && last.speed! >= HARSH_MIN_SPEED) harsh.push({ kind: 'hard_brake', at: cur, accel, speed: last.speed! });
        else if (accel >= HARSH_MPS2 && cur.speed! >= HARSH_MIN_SPEED) harsh.push({ kind: 'rapid_accel', at: cur, accel, speed: cur.speed! });
      }
    }
    if (cur.accuracy == null || cur.accuracy <= 100) last = cur;
  }
  // One event per manoeuvre: drop repeats of the same kind within a few seconds.
  const deduped: HarshEvent[] = [];
  for (const e of harsh) {
    const prior = deduped.findLast((d) => d.kind === e.kind);
    if (prior && e.at.t - prior.at.t < HARSH_DEDUPE_MS) {
      if (Math.abs(e.accel) > Math.abs(prior.accel)) Object.assign(prior, e);
      continue;
    }
    deduped.push(e);
  }
  return { speeding, harsh: deduped };
}

/** Store events found in freshly ingested fixes. Speeding episodes are extended across batches. */
export async function recordDrivingEvents(ctx: Ctx, userId: string, deviceId: string, prev: DrivingFix | null, fixes: DrivingFix[]) {
  const { sql } = ctx;
  const { speeding, harsh } = detectDriving(prev, fixes, ctx.config.DRIVING_SPEEDING_KMH / 3.6);

  for (const f of speeding) {
    const at = new Date(f.t);
    const [extended] = await sql<{ id: number }[]>`
      UPDATE driving_events SET
        started_at = LEAST(started_at, ${at}), ended_at = GREATEST(ended_at, ${at}),
        speed = GREATEST(speed, ${f.speed}), samples = samples + 1, shared = shared AND ${f.shared}
      WHERE id = (
        SELECT id FROM driving_events
        WHERE device_id = ${deviceId} AND kind = 'speeding'
          AND ended_at >= ${new Date(f.t - SPEEDING_GAP_MS)} AND started_at <= ${new Date(f.t + SPEEDING_GAP_MS)}
        ORDER BY ended_at DESC LIMIT 1)
      RETURNING id`;
    if (!extended) {
      await sql`
        INSERT INTO driving_events (user_id, device_id, kind, started_at, ended_at, lat, lon, speed, shared)
        VALUES (${userId}, ${deviceId}, 'speeding', ${at}, ${at}, ${f.lat}, ${f.lon}, ${f.speed}, ${f.shared})`;
    }
  }

  for (const e of harsh) {
    const at = new Date(e.at.t);
    await sql`
      INSERT INTO driving_events (user_id, device_id, kind, started_at, ended_at, lat, lon, speed, value, shared)
      SELECT ${userId}, ${deviceId}, ${e.kind}, ${at}, ${at}, ${e.at.lat}, ${e.at.lon}, ${e.speed}, ${e.accel}, ${e.at.shared}
      WHERE NOT EXISTS (
        SELECT 1 FROM driving_events WHERE device_id = ${deviceId} AND kind = ${e.kind}
          AND started_at BETWEEN ${new Date(e.at.t - HARSH_DEDUPE_MS)} AND ${new Date(e.at.t + HARSH_DEDUPE_MS)})`;
  }
}

/**
 * Phone unlocks reported by the app. Each becomes a "phone use" event when the
 * person was moving at the time (judged from their own fixes around it).
 */
export async function recordPhoneUse(ctx: Ctx, userId: string, deviceId: string, times: number[]): Promise<number> {
  const { sql } = ctx;
  let recorded = 0;
  for (const t of [...new Set(times)].sort((a, b) => a - b)) {
    const at = new Date(t);
    const [fix] = await sql<{ lat: number; lon: number; speed: number; shared: boolean }[]>`
      SELECT lat, lon, speed, shared FROM locations
      WHERE user_id = ${userId} AND speed IS NOT NULL
        AND recorded_at BETWEEN ${new Date(t - PHONE_USE_WINDOW_MS)} AND ${new Date(t + PHONE_USE_WINDOW_MS)}
      ORDER BY speed DESC LIMIT 1`;
    if (!fix || fix.speed < PHONE_USE_MIN_SPEED) continue;
    const rows = await sql`
      INSERT INTO driving_events (user_id, device_id, kind, started_at, ended_at, lat, lon, speed, shared)
      SELECT ${userId}, ${deviceId}, 'phone_use', ${at}, ${at}, ${fix.lat}, ${fix.lon}, ${fix.speed}, ${fix.shared}
      WHERE NOT EXISTS (
        SELECT 1 FROM driving_events WHERE user_id = ${userId} AND kind = 'phone_use'
          AND started_at BETWEEN ${new Date(t - PHONE_USE_DEDUPE_MS)} AND ${new Date(t + PHONE_USE_DEDUPE_MS)})
      RETURNING id`;
    recorded += rows.length;
  }
  return recorded;
}

/** Speeding needs two fixes so a single GPS glitch never counts. */
export const COUNTED = `(kind <> 'speeding' OR samples >= 2)`;
