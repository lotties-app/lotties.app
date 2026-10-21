/// <reference lib="webworker" />
/*
 * Lotties service worker (AGPL-3.0-or-later), built by vite-plugin-pwa (injectManifest) to sw.js.
 *
 * Only built, hashed assets are precached (the list is injected at build time). The user decides
 * when a new version takes over: src/pwa/ReloadPrompt.tsx posts SKIP_WAITING. Push notifications
 * (docs/design/09-push-notifications.md section 10) are handled in pushHandlers.ts.
 */
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NAVIGATION_DENYLIST, NAVIGATION_FALLBACK } from './navigation';
import { registerPushHandlers } from './pushHandlers';
import { normaliseApiBase } from './snoozeAction';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(NAVIGATION_FALLBACK), {
    denylist: NAVIGATION_DENYLIST,
  }),
);

registerPushHandlers({
  scope: self,
  fetch: (input, init) => fetch(input, init),
  // Same build-time value as src/config/appConfig.ts (empty = same origin).
  apiBaseUrl: normaliseApiBase(import.meta.env.VITE_API_BASE_URL),
});
