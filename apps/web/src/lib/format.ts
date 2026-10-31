import { format, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';

export { formatDistance, formatDuration, formatSpeed, speedUnit, speedValue } from '@nodara/shared';

/** How fresh a location is. Thresholds tuned for phone update intervals. */
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
  const d = new Date(iso);
  if (Date.now() - d.getTime() < 45_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function clock(iso: string | Date) {
  return format(typeof iso === 'string' ? new Date(iso) : iso, 'h:mm a');
}

export function dayLabel(d: Date) {
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d');
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function coords(lat: number, lon: number) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function deviceLabel(ua = navigator.userAgent): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
}

export function userAgentSummary(ua: string | null) {
  return ua ? deviceLabel(ua) : 'Unknown device';
}
