import type { MemberLocation } from './types';

/**
 * Same rules as the iOS app (apps/mobile/src/lib/driving.ts): whether someone
 * is driving right now, stopped mid-drive (a red light, traffic, a
 * drive-thru: shown as 0 for up to 3 minutes), or neither (parked, walking).
 */
const SHOW_SPEED_MPS = 4;
const VEHICLE_MPS = 7;
const STILL_MPS = 1;
const QUIET_MS = 30_000;
export const STOPPED_SHOW_MS = 3 * 60_000;

export type DriveState = { speed: number; stopped: boolean; stoppedForMs: number };

export function driveState(m: MemberLocation, now = Date.now()): DriveState | null {
  const l = m.location;
  if (!l) return null;
  const age = now - Date.parse(l.recordedAt);
  if (age > 5 * 60_000) return null;
  const speed = l.speed ?? 0;
  const trip = m.currentTrip ?? null;
  const vehicle = (trip?.maxSpeed ?? 0) >= VEHICLE_MPS || (speed >= SHOW_SPEED_MPS && age <= QUIET_MS);
  if (!vehicle) return null;
  if (speed >= STILL_MPS && age <= QUIET_MS) {
    if (!trip && speed < SHOW_SPEED_MPS) return null;
    return { speed, stopped: false, stoppedForMs: 0 };
  }
  if (!trip) return null;
  const since = trip.stoppedSince ? Date.parse(trip.stoppedSince) : Date.parse(l.recordedAt) + (speed < STILL_MPS ? 0 : 5_000);
  if (now - since > STOPPED_SHOW_MS) return null;
  return { speed: 0, stopped: true, stoppedForMs: Math.max(0, now - since) };
}

export const stoppedFor = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
