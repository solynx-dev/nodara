import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, ApiError, currentCredentials, request } from './api';
import type { Me, PublicConfig } from './types';

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Domains this build of the app may use passkeys with. They must match the
 * `webcredentials:` entries in app.json (Apple only lets an app use passkeys
 * for domains it's entitled to). Other servers manage passkeys on the web.
 */
export const PASSKEY_DOMAINS = ['nodara.ca', 'demo.nodara.ca'];

type PasskeysModule = typeof import('react-native-passkeys');
let passkeysModule: PasskeysModule | null | undefined;
/** Loaded lazily: older development builds don't include the native module. */
function passkeys(): PasskeysModule | null {
  if (passkeysModule !== undefined) return passkeysModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    passkeysModule = require('react-native-passkeys') as PasskeysModule;
  } catch {
    passkeysModule = null;
  }
  return passkeysModule;
}

/** Can this iPhone create and use passkeys for the connected server? */
export function passkeysAvailable(config: PublicConfig | null): boolean {
  if (Platform.OS !== 'ios' || !config?.passkeyRpId || !PASSKEY_DOMAINS.includes(config.passkeyRpId)) return false;
  try {
    return Boolean(passkeys()?.isSupported());
  } catch {
    return false;
  }
}

const cancelled = (e: unknown) => /cancel/i.test(`${(e as { code?: string }).code ?? ''} ${(e as Error).message ?? ''}`);

/** Add a passkey for the signed-in account. Resolves false if the person backed out. */
export async function createPasskey(name: string): Promise<boolean> {
  const pk = passkeys();
  if (!pk) throw new Error('Passkeys need the latest version of the app.');
  const { challengeId, options } = await api.post<{ challengeId: string; options: Parameters<PasskeysModule['create']>[0] }>('/api/auth/passkeys/register/options');
  try {
    const response = await pk.create(options);
    if (!response) return false;
    await api.post('/api/auth/passkeys/register/verify', { challengeId, response, name });
    return true;
  } catch (e) {
    if (cancelled(e)) return false;
    throw e;
  }
}

/** Sign in with a passkey saved on this iPhone (or iCloud Keychain). Null if the person backed out. */
export async function passkeySignIn(): Promise<{ user: Me; token: string } | null> {
  const pk = passkeys();
  if (!pk) throw new Error('Passkeys need the latest version of the app.');
  const { challengeId, options } = await request<{ challengeId: string; options: Parameters<PasskeysModule['get']>[0] }>(
    'POST',
    '/api/auth/passkeys/login/options',
    {},
    { token: null },
  );
  try {
    const response = await pk.get(options);
    if (!response) return null;
    return await request<{ user: Me; token: string }>('POST', '/api/auth/passkeys/login/verify', { challengeId, response, client: 'native' }, { token: null });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

export type ExportFormat = 'json' | 'gpx' | 'csv' | 'geojson';

/** Download an export of your data and open the share sheet (Save to Files, AirDrop…). */
export async function exportData(format: ExportFormat) {
  const c = currentCredentials();
  if (!c?.server || !c.token) throw new ApiError(401, 'unauthorized', 'Sign in again');
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File(Paths.cache, `nodara-export-${stamp}.${format}`);
  if (file.exists) file.delete();
  const saved = await File.downloadFileAsync(`${c.server}/api/me/export?format=${format}`, file, { headers: { Authorization: `Bearer ${c.token}` } });
  const types: Record<ExportFormat, string> = { json: 'application/json', gpx: 'application/gpx+xml', csv: 'text/csv', geojson: 'application/geo+json' };
  await Sharing.shareAsync(saved.uri, { mimeType: types[format], dialogTitle: 'Your Nodara data' });
}

/** "Nodara on iPhone", "Safari on Mac"… from a session's user agent. */
export function deviceSummary(ua: string | null): { name: string; icon: 'iphone' | 'laptopcomputer' | 'desktopcomputer' | 'globe' } {
  if (!ua) return { name: 'Unknown device', icon: 'globe' };
  if (/Nodara|okhttp|Expo|CFNetwork|Darwin/i.test(ua) && !/Mozilla/i.test(ua)) return { name: 'Nodara app', icon: 'iphone' };
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  if (/iPhone/.test(ua)) return { name: `${browser} on iPhone`, icon: 'iphone' };
  if (/iPad/.test(ua)) return { name: `${browser} on iPad`, icon: 'iphone' };
  if (/Android/.test(ua)) return { name: `${browser} on Android`, icon: 'iphone' };
  if (/Macintosh/.test(ua)) return { name: `${browser} on Mac`, icon: 'laptopcomputer' };
  if (/Windows/.test(ua)) return { name: `${browser} on Windows`, icon: 'desktopcomputer' };
  if (/Linux/.test(ua)) return { name: `${browser} on Linux`, icon: 'desktopcomputer' };
  return { name: browser, icon: 'globe' };
}
