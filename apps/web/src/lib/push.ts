import { api } from './api';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupport(): { supported: boolean; reason?: string } {
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'This browser does not support service workers.' };
  if (!('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return {
      supported: false,
      reason: ios ? 'On iPhone and iPad, add Nodara to your Home Screen first (Share → Add to Home Screen), then enable notifications from the installed app.' : 'This browser does not support web push notifications.',
    };
  }
  return { supported: true };
}

export async function enablePush(deviceId: string, vapidKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }));
  await api.put(`/api/devices/${deviceId}/push`, { subscription: sub.toJSON() });
}

export async function disablePush(deviceId: string) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
  await api.del(`/api/devices/${deviceId}/push`);
}
