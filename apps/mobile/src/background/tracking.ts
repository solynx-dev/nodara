import * as Location from 'expo-location';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/lib/api';
import { getItem, KEYS, setItem } from '@/lib/storage';
import { haversine } from '@/lib/format';
import type { PlaceWithMeta } from '@/lib/types';
import { GEOFENCE_TASK, LOCATION_TASK } from './tasks';
import { resetMotion } from './motion';

export type TrackingMode = 'precise' | 'balanced';
/** What new installs share with (and what's assumed when nothing was chosen yet). */
export const DEFAULT_MODE: TrackingMode = 'precise';

/**
 * Each mode has two settings, and the background task switches between them
 * on its own (see motion.ts):
 *  - `options` while on the move: Precise reports even when you stop at a red
 *    light (no distance filter), so your circle sees 0 km/h, not a stale speed;
 *  - `parkedOptions` once you've been still for a few minutes: iOS then stays
 *    quiet until you move again, which saves battery.
 */
export const MODES: Record<TrackingMode, { label: string; detail: string; options: Location.LocationTaskOptions; parkedOptions: Location.LocationTaskOptions }> = {
  precise: {
    label: 'Precise',
    detail: 'Recommended. Near-live driving (every 5 seconds, including at red lights), detailed trips and quicker arrival alerts. Uses a bit more battery while you move.',
    options: {
      accuracy: Location.Accuracy.High,
      distanceInterval: 0,
      deferredUpdatesInterval: 5_000,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
    },
    parkedOptions: {
      accuracy: Location.Accuracy.High,
      distanceInterval: 40,
      deferredUpdatesInterval: 5_000,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
    },
  },
  balanced: {
    label: 'Battery saver',
    detail: 'Updates about every 10 seconds while driving and goes quiet when you stay put. Stops may take a little longer to show.',
    options: {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 10,
      deferredUpdatesInterval: 10_000,
      pausesUpdatesAutomatically: true,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
    },
    parkedOptions: {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 100,
      deferredUpdatesInterval: 10_000,
      pausesUpdatesAutomatically: true,
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
  return { running, foreground: fg.status, background: bg.status, mode: (mode as TrackingMode) || DEFAULT_MODE };
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
    await resetMotion();
    await AsyncStorage.setItem(OPTIONS_KEY, OPTIONS_VERSION);
  } catch {
    // Not available in Expo Go — the foreground watcher in the app still reports while open.
  }
  return level;
}

/** Bump when MODES options change, so phones already sharing pick up the new settings. */
const OPTIONS_VERSION = '3';
const OPTIONS_KEY = 'nodara.trackingOptions';

/**
 * iOS keeps the options a location task was started with. After an app update
 * changes them, restart the running task once (in the foreground, no prompts).
 */
export async function refreshTrackingOptions() {
  try {
    const mode = (await getItem(KEYS.tracking)) as TrackingMode | null;
    if (!mode || !MODES[mode]) return;
    if ((await AsyncStorage.getItem(OPTIONS_KEY)) === OPTIONS_VERSION) return;
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) return;
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    await Location.startLocationUpdatesAsync(LOCATION_TASK, MODES[mode].options);
    await resetMotion();
    await AsyncStorage.setItem(OPTIONS_KEY, OPTIONS_VERSION);
  } catch {
    // Not available in Expo Go.
  }
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
