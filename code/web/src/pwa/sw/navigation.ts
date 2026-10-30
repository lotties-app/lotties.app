/** The app shell every navigation falls back to when offline (precached by the build). */
export const NAVIGATION_FALLBACK = '/index.html';

/**
 * Navigations that never get the app shell: API calls and the OIDC callback go to the network.
 * These are never cached either (the only runtime cache is the cry monitor's /models/cry/, cryAssets.ts).
 */
export const NAVIGATION_DENYLIST: RegExp[] = [/^\/api(\/|$)/, /^\/auth\/callback/];
