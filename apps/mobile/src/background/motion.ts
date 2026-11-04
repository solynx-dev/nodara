import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { getItem, KEYS } from '@/lib/storage';
import { haversine } from '@/lib/format';

/**
 * Switches background tracking between "moving" and "parked" settings.
 *
 * While moving (driving, or stopped at a light), the phone reports every few
 * seconds even when it isn't going anywhere, so circles see 0 km/h at a red
 * light instead of a frozen speed. After five minutes in the same spot it
 * switches to the parked setting, where iOS stays quiet until the phone has
 * moved about 40 m (100 m in Battery saver), then switches straight back.
 *
 * Re-starting the running task only updates the existing location manager's
 * settings, so it works from the background without any prompt.
 */

const KEY = 'nodara.motion';
/** Still for this long → parked. */
const PARK_AFTER_MS = 5 * 60_000;
/** Moving faster than this (m/s), or this far from where we settled, counts as moving. */
const MOVING_MPS = 1.5;
const MOVED_M = 40;

interface MotionState {
  profile: 'moving' | 'parked';
  /** Where and since when the phone has been still (null while moving). */
  still: { lat: number; lon: number; since: number } | null;
}

async function read(): Promise<MotionState> {
  try {
    return (JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as MotionState | null) ?? { profile: 'moving', still: null };
  } catch {
    return { profile: 'moving', still: null };
  }
}

/** After (re)starting tracking: the task runs with the moving settings. */
export async function resetMotion() {
  await AsyncStorage.setItem(KEY, JSON.stringify({ profile: 'moving', still: null } satisfies MotionState));
}

export async function adaptToMotion(locations: Location.LocationObject[]) {
  // Lazy import avoids a cycle (tracking.ts imports this file).
  const { MODES } = await import('./tracking');
  const mode = (await getItem(KEYS.tracking)) as keyof typeof MODES | null;
  if (!mode || !MODES[mode]) return;
  const st = await read();
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp);
  for (const l of sorted) {
    if ((l.coords.accuracy ?? 999) > 100) continue;
    const speed = l.coords.speed ?? -1;
    const away = st.still ? haversine(st.still.lat, st.still.lon, l.coords.latitude, l.coords.longitude) : Infinity;
    if (speed >= MOVING_MPS || away > MOVED_M) {
      // Moving: restart the stillness clock wherever they next stop.
      st.still = speed >= MOVING_MPS ? null : { lat: l.coords.latitude, lon: l.coords.longitude, since: l.timestamp };
    }
  }
  const newest = sorted[sorted.length - 1]?.timestamp ?? Date.now();
  const target: MotionState['profile'] = st.still && newest - st.still.since >= PARK_AFTER_MS ? 'parked' : 'moving';
  if (target !== st.profile) {
    try {
      await Location.startLocationUpdatesAsync('nodara-location-updates', target === 'parked' ? MODES[mode].parkedOptions : MODES[mode].options);
      st.profile = target;
    } catch {
      // Keep the current settings; we'll try again on the next batch.
    }
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(st));
}
