import type { SFSymbol } from 'expo-symbols';
import type { Units } from './format';
import type { MemberLocation } from './types';

/** Show someone's speed on the map once they're clearly travelling (≈ 15 km/h). */
export const SHOW_SPEED_MPS = 4;

/** The red "very fast" warning: 130 km/h, or 80 mph for people who use miles. */
export const redSpeedMps = (units: Units) => (units === 'imperial' ? 80 / 2.236936 : 130 / 3.6);
export const redSpeedLabel = (units: Units) => (units === 'imperial' ? '80 mph' : '130 km/h');

export const speedValue = (mps: number, units: Units) => Math.round(units === 'imperial' ? mps * 2.236936 : mps * 3.6);
export const speedUnit = (units: Units) => (units === 'imperial' ? 'mph' : 'km/h');

/** A trip that has reached this speed is a drive, not a walk (≈ 25 km/h). */
const VEHICLE_MPS = 7;
/** Below this they're standing still (GPS reports a little speed even when parked). */
const STILL_MPS = 1;
/** With no new fix for this long mid-drive, they've stopped: iOS goes quiet when a phone stops moving. */
const QUIET_MS = 30_000;
/** Show "0 km/h" for this long after stopping (a red light, a drive-thru); after that they've parked. */
export const STOPPED_SHOW_MS = 3 * 60_000;

export type DriveState = { speed: number; stopped: boolean; stoppedSince: number | null; stoppedForMs: number };

/**
 * Whether someone is driving right now, as the map and status should show it:
 *  - moving in a vehicle: their speed;
 *  - stopped during a drive (a light, traffic, a drive-thru): 0, for up to 3 minutes;
 *  - parked longer, walking, or not on a drive: null (no speed shown).
 */
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
    // Slowing to a crawl in traffic still counts; a fresh walking pace after the trip's end doesn't.
    if (!trip && speed < SHOW_SPEED_MPS) return null;
    return { speed, stopped: false, stoppedSince: null, stoppedForMs: 0 };
  }
  // Standing still, or the phone went quiet (which on iOS means it stopped moving).
  if (!trip) return null;
  const since = trip.stoppedSince ? Date.parse(trip.stoppedSince) : speed < STILL_MPS ? Date.parse(l.recordedAt) : Date.parse(l.recordedAt) + 5_000;
  if (now - since > STOPPED_SHOW_MS) return null;
  return { speed: 0, stopped: true, stoppedSince: since, stoppedForMs: Math.max(0, now - since) };
}

/** Speed to show on the map (0 while stopped mid-drive), or null when they aren't driving. */
export function liveSpeed(m: MemberLocation, now = Date.now()): number | null {
  return driveState(m, now)?.speed ?? null;
}

export type DrivingKind = 'speeding' | 'phone_use' | 'rapid_accel' | 'hard_brake';
export const DRIVING_KINDS: DrivingKind[] = ['speeding', 'phone_use', 'rapid_accel', 'hard_brake'];

export const KIND_INFO: Record<DrivingKind, { label: string; short: string; icon: SFSymbol; color: string; explain: (units: Units) => string }> = {
  speeding: { label: 'Speeding', short: 'speeding', icon: 'gauge.with.dots.needle.100percent', color: '#FF3B30', explain: (u) => `Driving over ${redSpeedLabel(u)}` },
  phone_use: { label: 'Phone use', short: 'phone use', icon: 'iphone.gen3.radiowaves.left.and.right', color: '#30B0C7', explain: () => 'Phone unlocked while moving (passengers count too)' },
  rapid_accel: { label: 'Rapid acceleration', short: 'rapid accel', icon: 'bolt.fill', color: '#AF52DE', explain: () => 'Speeding up very quickly' },
  hard_brake: { label: 'Hard braking', short: 'hard braking', icon: 'exclamationmark.octagon.fill', color: '#FF9500', explain: () => 'Slowing down very suddenly' },
};
