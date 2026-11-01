import type { SFSymbol } from 'expo-symbols';
import { freshness, type Units } from './format';
import type { MemberLocation } from './types';

/** Show someone's speed on the map once they're clearly travelling (≈ 15 km/h). */
export const SHOW_SPEED_MPS = 4;

/** The red "very fast" warning: 130 km/h, or 80 mph for people who use miles. */
export const redSpeedMps = (units: Units) => (units === 'imperial' ? 80 / 2.236936 : 130 / 3.6);
export const redSpeedLabel = (units: Units) => (units === 'imperial' ? '80 mph' : '130 km/h');

export const speedValue = (mps: number, units: Units) => Math.round(units === 'imperial' ? mps * 2.236936 : mps * 3.6);
export const speedUnit = (units: Units) => (units === 'imperial' ? 'mph' : 'km/h');

/** Live speed worth showing on the map, or null when they're not clearly moving right now. */
export function liveSpeed(m: MemberLocation): number | null {
  const l = m.location;
  if (!l || l.speed == null || freshness(l.recordedAt) !== 'live') return null;
  return l.speed >= SHOW_SPEED_MPS ? l.speed : null;
}

export type DrivingKind = 'speeding' | 'phone_use' | 'rapid_accel' | 'hard_brake';
export const DRIVING_KINDS: DrivingKind[] = ['speeding', 'phone_use', 'rapid_accel', 'hard_brake'];

export const KIND_INFO: Record<DrivingKind, { label: string; short: string; icon: SFSymbol; color: string; explain: (units: Units) => string }> = {
  speeding: { label: 'Speeding', short: 'speeding', icon: 'gauge.with.dots.needle.100percent', color: '#FF3B30', explain: (u) => `Driving over ${redSpeedLabel(u)}` },
  phone_use: { label: 'Phone use', short: 'phone use', icon: 'iphone.gen3.radiowaves.left.and.right', color: '#30B0C7', explain: () => 'Phone unlocked while moving (passengers count too)' },
  rapid_accel: { label: 'Rapid acceleration', short: 'rapid accel', icon: 'bolt.fill', color: '#AF52DE', explain: () => 'Speeding up very quickly' },
  hard_brake: { label: 'Hard braking', short: 'hard braking', icon: 'exclamationmark.octagon.fill', color: '#FF9500', explain: () => 'Slowing down very suddenly' },
};
