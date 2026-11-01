import AsyncStorage from '@react-native-async-storage/async-storage';
import { PhoneUse } from '../../modules/phone-use';

/**
 * Phone use while driving, for weekly driving reports.
 *
 * Two signals: the iPhone being unlocked (recorded natively by the PhoneUse
 * module, even while another app is open) and Nodara itself being opened. Both
 * are just timestamps; the server only counts the ones that happened while
 * this person was moving faster than ~16 km/h.
 */
const KEY = 'nodara.phoneUse';
const MAX = 500;

async function read(): Promise<number[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as number[];
  } catch {
    return [];
  }
}

export async function notePhoneUse(at = Date.now()) {
  await AsyncStorage.setItem(KEY, JSON.stringify([...(await read()), at].slice(-MAX)));
}

/** Send pending unlock times. Called after locations are uploaded, so the server can match them. */
export async function flushPhoneUse(server: string, token: string) {
  let native: number[] = [];
  try {
    native = PhoneUse?.takeUnlocks() ?? [];
  } catch {}
  const times = [...(await read()), ...native].slice(-MAX);
  if (!times.length) return;
  // Keep them until the server has them.
  await AsyncStorage.setItem(KEY, JSON.stringify(times));
  try {
    const res = await fetch(`${server}/api/driving/phone-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ times }),
    });
    // 400: malformed, 404: server without driving reports. Neither will ever succeed.
    if (res.ok || res.status === 400 || res.status === 404) await AsyncStorage.removeItem(KEY);
  } catch {
    // Offline: try again with the next upload.
  }
}
