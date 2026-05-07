/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

type PushPayload = {
  aps?: {
    alert?: {
      title?: string;
      body?: string;
    };
  };
  title?: string;
  body?: string;
  url?: string;
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

registerRoute(
  ({ url }: { url: URL }) =>
    url.hostname.includes('.supabase.co') && url.pathname.startsWith('/functions/v1/'),
  new NetworkFirst({ cacheName: 'api-cache', networkTimeoutSeconds: 5 }),
);

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let data: PushPayload = {};
  try { data = event.data.json(); } catch { data = {}; }

  // Support both APNs format {"aps":{"alert":{...}}} and flat {"title":...,"body":...}
  const alert = data.aps?.alert;
  const title: string = alert?.title ?? data.title ?? 'Pickla';
  const body: string  = alert?.body  ?? data.body  ?? '';
  const url: string   = data.url ?? '/hub';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'pickla-hub',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url: string = (event.notification.data?.url as string) ?? '/hub';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        const win = list.find((c) => c.url.startsWith(self.location.origin));
        if (win) {
          (win as WindowClient).navigate(url);
          win.focus();
          return;
        }
        self.clients.openWindow(url);
      }),
  );
});
