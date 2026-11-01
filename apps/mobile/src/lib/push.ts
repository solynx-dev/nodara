import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { api } from './api';
import { getItem, KEYS } from './storage';
import { ensureDevice } from '@/background/tracking';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Turn on push for this iPhone. Apple only delivers pushes signed with the
 * app publisher's key, so the self-hosted server relays through Expo's push
 * service; the payload is just the notification text.
 */
export async function enablePush(): Promise<void> {
  if (!Device.isDevice) throw new Error('Push notifications need a real iPhone, not the simulator.');
  const perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== 'granted') throw new Error('Notifications are turned off for Nodara in iOS Settings.');
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build has no EAS project ID. Run `npx eas-cli init` and rebuild.');
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const deviceId = await ensureDevice();
  await api.put(`/api/devices/${deviceId}/native-push`, { token });
}

/**
 * Re-send this iPhone's push token on launch when push is on. The token
 * changes between development and TestFlight / App Store builds (Apple's
 * sandbox vs production push service) and can rotate, and a stale one means
 * notifications silently stop arriving.
 */
export async function syncPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
    const deviceId = await getItem(KEYS.deviceId);
    if (!deviceId) return;
    const devices = await api.get<{ id: string; pushEnabled: boolean }[]>('/api/devices');
    if (!devices.find((d) => d.id === deviceId)?.pushEnabled) return; // they turned push off in Nodara
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.put(`/api/devices/${deviceId}/native-push`, { token });
  } catch {
    // Best effort; the Settings switch still works.
  }
}

export async function disablePush() {
  const deviceId = await ensureDevice();
  await api.del(`/api/devices/${deviceId}/native-push`);
}

export async function pushPermission() {
  return (await Notifications.getPermissionsAsync()).status;
}

/** Map a server notification URL (web routes) to an app route. */
export function routeForUrl(url: string | undefined): string | null {
  if (!url) return null;
  const member = /member=([0-9a-f-]{36})/.exec(url);
  if (member) return `/?member=${member[1]}`;
  const trip = /^\/trips\/([0-9a-f-]{36})/.exec(url);
  if (trip) return `/trip/${trip[1]}`;
  if (url.startsWith('/circles')) return '/';
  return '/alerts';
}
