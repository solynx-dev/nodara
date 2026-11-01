import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import type * as Location from 'expo-location';
import { getItem, KEYS } from '@/lib/storage';
import { flushPhoneUse } from './phoneUse';

/** A fix in the shape the Nodara ingestion API expects. */
export interface Fix {
  recordedAt: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery: number | null;
  charging: boolean | null;
}

const QUEUE_KEY = 'nodara.queue';
const MAX_QUEUE = 5000;
let flushing: Promise<void> | null = null;

export async function toFixes(locations: Location.LocationObject[]): Promise<Fix[]> {
  let battery: number | null = null;
  let charging: boolean | null = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    battery = level >= 0 ? Math.round(level * 100) : null;
    const state = await Battery.getBatteryStateAsync();
    charging = state === Battery.BatteryState.UNKNOWN ? null : state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
  } catch {}
  return locations.map((l) => ({
    recordedAt: new Date(l.timestamp).toISOString(),
    lat: l.coords.latitude,
    lon: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    altitude: l.coords.altitude ?? null,
    altitudeAccuracy: l.coords.altitudeAccuracy ?? null,
    // iOS reports -1 when speed/course are unknown.
    speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    heading: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,
    battery,
    charging,
  }));
}

async function readQueue(): Promise<Fix[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]') as Fix[];
  } catch {
    return [];
  }
}

export async function pendingCount() {
  return (await readQueue()).length;
}

/**
 * Queue fixes and try to send everything. Runs in the background task, so it
 * authenticates with the device token (which can only submit locations), not
 * the user's session. Failed uploads stay queued for the next wake-up.
 */
export async function enqueueAndFlush(fixes: Fix[]) {
  if (fixes.length) {
    const q = [...(await readQueue()), ...fixes].slice(-MAX_QUEUE);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }
  flushing ??= flush().finally(() => (flushing = null));
  return flushing;
}

async function flush() {
  const [server, token] = await Promise.all([getItem(KEYS.server), getItem(KEYS.deviceToken)]);
  if (!server || !token) return;
  let q = await readQueue();
  while (q.length) {
    const batch = q.slice(0, 500);
    let res: Response;
    try {
      res = await fetch(`${server}/api/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ locations: batch }),
      });
    } catch {
      return; // offline — keep the queue
    }
    if (res.status === 400) {
      // Malformed data will never succeed; drop this batch.
    } else if (!res.ok) {
      return;
    }
    q = q.slice(batch.length);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    await AsyncStorage.setItem('nodara.lastUpload', new Date().toISOString());
  }
  // Locations first, so the server knows whether you were moving when the phone was unlocked.
  await flushPhoneUse(server, token);
}

export async function lastUpload() {
  return AsyncStorage.getItem('nodara.lastUpload');
}
