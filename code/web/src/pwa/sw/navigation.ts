/** The app shell every navigation falls back to when offline (precached by the build). */
export const NAVIGATION_FALLBACK = '/index.html';

/**
 * Navigations that never get the app shell: API calls and the OIDC callback go to the network.
 * No runtime caching exists, so these are never cached either.
 */
export const NAVIGATION_DENYLIST: RegExp[] = [/^\/api(\/|$)/, /^\/auth\/callback/];
