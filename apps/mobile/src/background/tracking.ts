import * as Location from 'expo-location';
import * as Device from 'expo-device';
import { api } from '@/lib/api';
import { getItem, KEYS, setItem } from '@/lib/storage';
import { haversine } from '@/lib/format';
import type { PlaceWithMeta } from '@/lib/types';
import { GEOFENCE_TASK, LOCATION_TASK } from './tasks';

export type TrackingMode = 'balanced' | 'precise';

export const MODES: Record<TrackingMode, { label: string; detail: string; options: Location.LocationTaskOptions }> = {
  balanced: {
    label: 'Battery saver',
    detail: 'Updates when you move about 100 m. iOS pauses updates when you stay put.',
    options: {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 100,
      deferredUpdatesInterval: 60_000,
      pausesUpdatesAutomatically: true,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
    },
  },
  precise: {
    label: 'Precise',
    detail: 'Detailed trips and quicker arrival alerts. Uses more battery.',
    options: {
      accuracy: Location.Accuracy.High,
      distanceInterval: 25,
      deferredUpdatesInterval: 15_000,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
    },
  },
};

/** Register this iPhone as a Nodara device once and keep its ingest-only token in the Keychain. */
export async function ensureDevice(): Promise<string> {
  const existing = await getItem(KEYS.deviceId);
  const token = await getItem(KEYS.deviceToken);
  if (existing && token) {
    const devices = await api.get<{ id: string }[]>('/api/devices');
    if (devices.some((d) => d.id === existing)) return existing;
  }
  const name = Device.deviceName ?? Device.modelName ?? 'iPhone';
  const r = await api.post<{ device: { id: string }; token: string }>('/api/devices', { name, kind: 'ios' });
  await setItem(KEYS.deviceId, r.device.id);
  await setItem(KEYS.deviceToken, r.token);
  return r.device.id;
}

export interface TrackingStatus {
  running: boolean;
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
  mode: TrackingMode;
}

export async function trackingStatus(): Promise<TrackingStatus> {
  const [running, fg, bg, mode] = await Promise.all([
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false),
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync().catch(() => ({ status: Location.PermissionStatus.UNDETERMINED })),
    getItem(KEYS.tracking),
  ]);
  return { running, foreground: fg.status, background: bg.status, mode: (mode as TrackingMode) || 'balanced' };
}

/**
 * Ask for "While Using" first, then "Always" — the order iOS requires — and
 * start background updates. Returns the resulting permission level.
 */
export async function startTracking(mode: TrackingMode): Promise<'always' | 'foreground' | 'denied'> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  await ensureDevice();
  let level: 'always' | 'foreground' = 'foreground';
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status === 'granted') level = 'always';
  } catch {
    // Expo Go cannot request background location; foreground-only still works.
  }
  await setItem(KEYS.tracking, mode);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    await Location.startLocationUpdatesAsync(LOCATION_TASK, MODES[mode].options);
  } catch {
    // Not available in Expo Go — the foreground watcher in the app still reports while open.
  }
  return level;
}

export async function stopTracking() {
  await setItem(KEYS.tracking, null);
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}

/**
 * iOS can monitor at most 20 regions per app, so register the places closest
 * to where you are. Called whenever places change or the app comes to the front.
 */
export async function syncGeofences(places: PlaceWithMeta[], near: { lat: number; lon: number } | null) {
  const status = await trackingStatus();
  if (!status.running || status.background !== 'granted') return;
  const sorted = near ? [...places].sort((a, b) => haversine(near.lat, near.lon, a.lat, a.lon) - haversine(near.lat, near.lon, b.lat, b.lon)) : places;
  const regions = sorted.slice(0, 20).map((p) => ({
    identifier: p.id,
    latitude: p.lat,
    longitude: p.lon,
    radius: Math.max(100, p.radiusM),
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  try {
    if (regions.length) await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    else if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {}
}
