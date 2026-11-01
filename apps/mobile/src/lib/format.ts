export type Units = 'metric' | 'imperial';

const toRad = (d: number) => (d * Math.PI) / 180;
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type Freshness = 'live' | 'recent' | 'stale' | 'old';
export function freshness(iso: string | null | undefined, now = Date.now()): Freshness {
  if (!iso) return 'old';
  const age = now - Date.parse(iso);
  if (age < 2 * 60_000) return 'live';
  if (age < 15 * 60_000) return 'recent';
  if (age < 6 * 3600_000) return 'stale';
  return 'old';
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatSpeed(mps: number | null | undefined, units: Units) {
  if (mps == null) return '—';
  return units === 'imperial' ? `${Math.round(mps * 2.236936)} mph` : `${Math.round(mps * 3.6)} km/h`;
}

export function formatDistance(m: number | null | undefined, units: Units) {
  if (m == null) return '—';
  if (units === 'imperial') {
    const mi = m / 1609.344;
    return mi < 0.1 ? `${Math.round(m / 0.3048)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatDuration(sec: number) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : m ? `${m} min` : `${s} s`;
}

export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

export const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
export const coords = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/** Long, human durations for how long someone has been somewhere: "12 min", "3 h 12 min", "2 days 4 h". */
export function formatStay(sec: number) {
  const m = Math.max(1, Math.floor(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d} day${d === 1 ? '' : 's'}${rh && d < 3 ? ` ${rh} h` : ''}`;
}

/** "7:32 PM", "yesterday 7:32 PM", "Mon 7:32 PM" or "Oct 12". */
export function sinceLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return clock(iso);
  if (days === 1) return `yesterday ${clock(iso)}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock(iso)}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Short weekday letter/label for charts and chips. */
export const weekdayShort = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short' });
