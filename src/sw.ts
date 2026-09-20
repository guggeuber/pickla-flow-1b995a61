/// <reference lib="webworker" />
import { setCacheNameDetails } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { RUNNING_FRONTEND_BUILD } from '@/lib/frontendBuild';
import {
  LEGACY_CLIENT_HANDSHAKE_MS,
  recoverLegacyClients,
  type LegacyRecoveryClient,
} from '@/lib/legacyClientRecovery';

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = '2026-09-13-version-convergence';
const acknowledgedClientIds = new Set<string>();

setCacheNameDetails({
  prefix: 'pickla',
  suffix: CACHE_VERSION,
  precache: 'precache',
  runtime: 'runtime',
});

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
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (!event.data || typeof event.data !== 'object') return;
  const source = event.source;
  if (event.data.type === 'PICKLA_VERSION_CLIENT_ACK' && source && 'id' in source) {
    acknowledgedClientIds.add(source.id);
    return;
  }
  if (event.data.type === 'PICKLA_GET_BUILD' && source && 'postMessage' in source) {
    source.postMessage({ type: 'PICKLA_SW_BUILD', build: RUNNING_FRONTEND_BUILD });
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await self.caches.keys();
    await Promise.all(
      keys
        .filter((key) =>
          key.includes('workbox') ||
          key.includes('precache') ||
          key.includes('api-cache') ||
          key.includes('pickla-runtime') ||
          key.includes('pickla-precache')
        )
        .filter((key) => !key.includes(CACHE_VERSION))
        .map((key) => self.caches.delete(key))
    );
    await self.clients.claim();
    await recoverLegacyClients({
      build: RUNNING_FRONTEND_BUILD,
      acknowledgedClientIds,
      origin: self.location.origin,
      listClients: async () => (
        await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      ) as unknown as LegacyRecoveryClient[],
      waitForAcknowledgements: () => new Promise((resolve) => {
        setTimeout(resolve, LEGACY_CLIENT_HANDSHAKE_MS);
      }),
      onDiagnostic: (diagnostic, detail) => {
        console.info(`[frontend-version] ${diagnostic}`, detail);
      },
    });
  })());
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ request }: { request: Request }) => request.mode === 'navigate',
  new NetworkOnly(),
);

registerRoute(
  ({ url }: { url: URL }) =>
    url.origin === self.location.origin && url.pathname === '/api/release',
  new NetworkOnly(),
);

registerRoute(
  ({ url }: { url: URL }) =>
    url.hostname.includes('.supabase.co') && url.pathname.startsWith('/functions/v1/'),
  new NetworkOnly(),
);

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let data: PushPayload = {};
  try { data = event.data.json(); } catch { data = {}; }

  // Support both APNs format {"aps":{"alert":{...}}} and flat {"title":...,"body":...}
  const alert = data.aps?.alert;
  const title: string = alert?.title ?? data.title ?? 'Pickla';
  const body: string  = alert?.body  ?? data.body  ?? '';
  const url: string   = data.url ?? '/';

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
  const url: string = (event.notification.data?.url as string) ?? '/';

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
