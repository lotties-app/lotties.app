import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Lotties native shell (docs/design/12-mobile-capacitor.md). The web build is BUNDLED into the
 * app (`webDir`): the app starts and works offline from its own assets, never from a remote URL.
 * Build it with `npm run build:web` (code/web, Vite mode `native`: API at https://lotties.app).
 *
 * The local origins below are permanent decisions: IndexedDB (each account's Dexie database) and
 * localStorage (the OIDC session) belong to the origin, so changing a scheme or the hostname after
 * a release starts every user with an empty device (unsynced changes lost). The API's
 * CORS_ALLOWED_ORIGINS and the Keycloak client's Web origins list exactly these origins:
 * - Android: https://localhost (androidScheme `https`, the Capacitor default; a custom scheme
 *   breaks client-side routing on Android WebView 117+);
 * - iOS: capacitor://localhost (iosScheme `capacitor`, the Capacitor default). Not `lotties`: the
 *   content scheme must not collide with a URL scheme the app registers for links, and the default
 *   is the origin every Capacitor guide and CORS example expects.
 *
 * No `allowNavigation`: sign-in and sign-out run in the system browser (@capacitor/browser,
 * RFC 8252) and come back through the `app.lotties.app://` URL scheme; token and userinfo calls to
 * https://auth.lotties.app are fetch requests (CORS), not navigations. Without the entry, any stray
 * navigation to the identity provider opens in the system browser instead of the WebView, so a
 * password is never typed into an embedded view.
 */
const config: CapacitorConfig = {
  appId: 'app.lotties.app',
  appName: 'Lotties',
  webDir: '../web/dist',
  // Only the bundled assets: no `url` (a live-reload URL is for local development only and must
  // never be committed).
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    hostname: 'localhost',
  },
  // WebView debugging (chrome://inspect, Safari Web Inspector) stays the default: debug builds only.
  ios: {
    // The web app pads itself with env(safe-area-inset-*) (index.html has viewport-fit=cover).
    contentInset: 'never',
  },
  plugins: {
    SystemBars: {
      // Android: the WebView is edge-to-edge and env(safe-area-inset-*) carries the real insets.
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    Keyboard: {
      // iOS: the WebView shrinks above the keyboard, so bottom sheets stay visible.
      resize: 'native',
      // Android: resize the WebView above the keyboard although the app is edge-to-edge.
      resizeOnFullScreen: true,
    },
  },
};

export default config;
