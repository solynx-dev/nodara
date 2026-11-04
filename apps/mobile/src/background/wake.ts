import * as Location from 'expo-location';
import { enqueueAndFlush, toFixes } from './upload';
import { getItem, KEYS } from '@/lib/storage';

/** The silent push the server sends to ask for a fresh location. */
export const WAKE_KIND = 'locate';

/** True for Nodara's silent "send your location" push, from any delivery path. */
export function isWake(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as { nodara?: unknown; dataString?: unknown; body?: unknown };
  if (d.nodara === WAKE_KIND) return true;
  for (const raw of [d.dataString, d.body]) {
    if (typeof raw !== 'string') continue;
    try {
      if ((JSON.parse(raw) as { nodara?: unknown }).nodara === WAKE_KIND) return true;
    } catch {
      // not ours
    }
  }
  if (d.body && typeof d.body === 'object') return isWake(d.body);
  return false;
}

let running: Promise<boolean> | null = null;

/**
 * Take one fix and send it. Nothing is shown and nothing is recorded about
 * the request: it's just a location update, like any other. Does nothing
 * unless sharing is on in this app (a pause in Nodara is respected).
 */
export function sendFreshLocation(): Promise<boolean> {
  running ??= (async () => {
    try {
      if (!(await getItem(KEYS.tracking))) return false;
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return false;
      let pos: Location.LocationObject | null = null;
      try {
        // iOS gives a woken app ~30 s; leave time to upload.
        pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise<null>((r) => setTimeout(() => r(null), 20_000)),
        ]);
      } catch {
        pos = null;
      }
      pos ??= await Location.getLastKnownPositionAsync().catch(() => null);
      if (!pos) return false;
      await enqueueAndFlush(await toFixes([pos]));
      return true;
    } finally {
      running = null;
    }
  })();
  return running;
}
