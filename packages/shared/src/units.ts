export type UnitSystem = 'metric' | 'imperial';

export const MPS_TO_KMH = 3.6;
export const MPS_TO_MPH = 2.236936;
export const M_PER_MILE = 1609.344;
export const M_PER_FOOT = 0.3048;

export function speedValue(mps: number, units: UnitSystem): number {
  return mps * (units === 'imperial' ? MPS_TO_MPH : MPS_TO_KMH);
}

export function speedUnit(units: UnitSystem): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

export function formatSpeed(mps: number | null | undefined, units: UnitSystem, digits = 0): string {
  if (mps == null || !Number.isFinite(mps)) return '—';
  return `${speedValue(mps, units).toFixed(digits)} ${speedUnit(units)}`;
}

export function formatDistance(m: number | null | undefined, units: UnitSystem): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (units === 'imperial') {
    const miles = m / M_PER_MILE;
    if (miles < 0.1) return `${Math.round(m / M_PER_FOOT)} ft`;
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles).toLocaleString()} mi`;
  }
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString()} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m.toString().padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
