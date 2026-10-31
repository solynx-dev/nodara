/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// App shell: precached build assets, so Nodara opens offline.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Map styles, glyphs, sprites and tiles: cache-first with a size cap so
// recently viewed areas still render offline. API data is never cached.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin !== self.location.origin &&
    /tile|openfreemap|openstreetmap|glyph|sprite|font|\.pbf|\.png|\.mvt/i.test(url.href),
  new CacheFirst({
    cacheName: 'nodara-map',
    plugins: [new ExpirationPlugin({ maxEntries: 1500, maxAgeSeconds: 14 * 86400, purgeOnQuotaError: true })],
  }),
);

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// -- Web push --------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Nodara', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Nodara', {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          await (c as WindowClient).navigate(url).catch(() => {});
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
